import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import SettingsSelect from '@/features/settings/SettingsSelect';
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
import {
  getPaymentGatewayConfigScoped,
  setPaymentGatewayConfigScoped,
} from '@/api/payment-gateways';
import {
  isCoreRail,
  mergeCoreRails,
  computeRailsDirty,
  sanitizeRailCode,
  type DraftRail,
} from './paymentRailsLogic';
import './RestaurantSettingsScreens.css';

// ── Icons ───────────────────────────────────────────────────────────

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function QrisIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function EdcIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <circle cx="8" cy="15" r="1" />
      <circle cx="12" cy="15" r="1" />
      <circle cx="16" cy="15" r="1" />
      <circle cx="8" cy="18" r="1" />
      <circle cx="12" cy="18" r="1" />
      <circle cx="16" cy="18" r="1" />
    </svg>
  );
}

function MidtransIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function StripeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M2 16.1A5 5 0 0 1 5.9 14h12.2a5 5 0 0 1 3.9 2.1" />
      <line x1="12" y1="3" x2="12" y2="15" />
      <path d="m7 8 5-5 5 5" />
    </svg>
  );
}

function GenericRailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

// ── Payment Method Card Template ────────────────────────────────────

export interface PaymentMethodCardProps {
  id: string;
  title: string;
  description?: string | undefined;
  code: string;
  icon?: ReactNode | undefined;
  badge?: string | undefined;
  badgeVariant?: ('default' | 'primary' | 'success' | 'warning') | undefined;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  isCore?: boolean | undefined;
  onRemove?: (() => void) | undefined;
  removeAriaLabel?: string | undefined;
  mountBodyWhenCollapsed?: boolean | undefined;
  children?: ReactNode | undefined;
}

export function PaymentMethodCard({
  id,
  title,
  code,
  icon,
  enabled,
  onToggle,
  isCore = true,
  onRemove,
  removeAriaLabel,
  mountBodyWhenCollapsed = false,
  children,
}: PaymentMethodCardProps) {
  const [isExpanded, setIsExpanded] = useState(enabled);

  useEffect(() => {
    setIsExpanded(enabled);
  }, [enabled]);

  const shouldMountBody = isExpanded || mountBodyWhenCollapsed;

  return (
    <div
      className={`resto-payment-card-wrapper ${isExpanded ? 'resto-payment-card-wrapper--expanded' : 'resto-payment-card-wrapper--collapsed'}`}
      data-testid={`payment-card-${id}`}
    >
      <div className={`resto-payment-card ${isExpanded ? 'resto-payment-card--expanded' : 'resto-payment-card--collapsed'}`}>
        <div className="restaurant-settings-card-header resto-payment-card-header restaurant-rail-row">
          <div className="resto-payment-card-title-group">
            <button
              type="button"
              className="resto-card-expand-btn"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-expanded={isExpanded}
              aria-controls={`payment-card-body-${id}`}
              aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
              data-testid={`payment-card-expand-${id}`}
            >
              <span
                className={`resto-card-chevron ${isExpanded ? 'resto-card-chevron--expanded' : ''}`}
                aria-hidden="true"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
              {icon && (
                <span className="restaurant-settings-header-icon" aria-hidden="true">
                  {icon}
                </span>
              )}
              <span className="resto-payment-card-title">{title}</span>
            </button>
            <span className="restaurant-rail-code sr-only">{code}</span>
          </div>

          <div className="resto-payment-card-header-actions restaurant-rail-actions">
            {!isCore && onRemove && (
              <button
                type="button"
                className="restaurant-rail-remove"
                onClick={onRemove}
                aria-label={removeAriaLabel || `Remove ${title}`}
                data-testid={`payment-card-remove-${id}`}
              >
                &times;
              </button>
            )}
            <label className="settings-toggle-switch" htmlFor={`rail-toggle-${code}`}>
              <input
                id={`rail-toggle-${code}`}
                type="checkbox"
                role="switch"
                checked={enabled}
                aria-checked={enabled}
                aria-label={title}
                data-testid={`payment-card-toggle-${id}`}
                onChange={(e) => {
                  onToggle(e.target.checked);
                  setIsExpanded(e.target.checked);
                }}
              />
              <span className="settings-toggle-slider" aria-hidden="true" />
            </label>
          </div>
        </div>

        {shouldMountBody && children && (
          <div
            id={`payment-card-body-${id}`}
            className={`resto-payment-card-body ${!isExpanded ? 'resto-payment-card-body--hidden' : ''}`}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Screen Component ───────────────────────────────────────────

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
  const [drafts, setDrafts] = useState<DraftRail[]>(() => {
    const base = mergeCoreRails([]);
    const extras: DraftRail[] = [
      { rail_code: 'midtrans', label: 'Midtrans Gateway', is_enabled: false, parameters: '{}' },
      { rail_code: 'stripe', label: 'Stripe Processing', is_enabled: false, parameters: '{}' },
    ];
    return [...base, ...extras.filter((ex) => !base.some((b) => b.rail_code === ex.rail_code))];
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [edcTerminals, setEdcTerminals] = useState<EdcTerminalDto[]>([]);
  const [defaultEdcTerminalId, setDefaultEdcTerminalId] = useState('');
  const [testingEdc, setTestingEdc] = useState(false);

  // Fallback states for core toggles
  const [cashLocalEnabled, setCashLocalEnabled] = useState(true);
  const [qrisLocalEnabled, setQrisLocalEnabled] = useState(true);
  const [cardLocalEnabled, setCardLocalEnabled] = useState(false);

  // ── UI States for Expanded Payment Cards ──────────────────────────
  // Cash
  const [cashDrawerAutoKick, setCashDrawerAutoKick] = useState(true);
  const [cashDrawerVerify, setCashDrawerVerify] = useState(false);
  const [cashCustomLabel, setCashCustomLabel] = useState('Cash');
  const [activeCashPresets, setActiveCashPresets] = useState<string[]>([
    'exact',
    '1000',
    '2000',
    '5000',
    '10000',
    '20000',
    '50000',
    '100000',
  ]);

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

  // Custom Payment Rail Creation
  const [newRailCode, setNewRailCode] = useState('');
  const [newRailLabel, setNewRailLabel] = useState('');

  // Dirty state tracking
  const originalsRef = useRef<{
    drafts: DraftRail[];
    defaultEdcTerminalId: string;
  }>({ drafts: [], defaultEdcTerminalId: '' });
  const [dirtyVersion, setDirtyVersion] = useState(0);
  const hwInitializedRef = useRef(false);

  // Sync initial EDC terminal preference from hardware profile
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
    let cancelled = false;

    const loadAll = async () => {
      if (!sessionToken) return;
      setLoading(true);
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

          const mergedDrafts = mergeCoreRails(rawRails);
          const fullDrafts = [...mergedDrafts];
          const extras: DraftRail[] = [
            { rail_code: 'midtrans', label: 'Midtrans Gateway', is_enabled: false, parameters: '{}' },
            { rail_code: 'stripe', label: 'Stripe Processing', is_enabled: false, parameters: '{}' },
          ];
          for (const ex of extras) {
            if (!fullDrafts.some((d) => d.rail_code.toLowerCase() === ex.rail_code)) {
              fullDrafts.push(ex);
            }
          }

          setDrafts(fullDrafts);
          originalsRef.current.drafts = fullDrafts.map((d) => ({ ...d }));

          // Hydrate card configurations from merged parameters
          const cash = fullDrafts.find((d) => d.rail_code.toLowerCase() === 'cash');
          if (cash) {
            setCashLocalEnabled(cash.is_enabled);
            setCashCustomLabel(cash.label || 'Cash');
            try {
              const p = JSON.parse(cash.parameters);
              if (typeof p.autoKick === 'boolean') setCashDrawerAutoKick(p.autoKick);
              if (typeof p.verifyDrawer === 'boolean') setCashDrawerVerify(p.verifyDrawer);
              if (Array.isArray(p.presets) && p.presets.length > 0) setActiveCashPresets(p.presets);
            } catch {
              // Ignore parse error, keep defaults
            }
          }

          const qris = fullDrafts.find((d) => d.rail_code.toLowerCase() === 'qris');
          if (qris) {
            setQrisLocalEnabled(qris.is_enabled);
            try {
              const p = JSON.parse(qris.parameters);
              if (p.mode === 'static' || p.mode === 'dynamic') setQrisMode(p.mode);
              if (p.nmid) setQrisNmid(p.nmid);
              if (p.surcharge) setQrisSurcharge(p.surcharge);
              if (typeof p.printReceipt === 'boolean') setQrisPrintReceipt(p.printReceipt);
            } catch {
              // Ignore parse error, keep defaults
            }
          }

          const card = fullDrafts.find((d) => d.rail_code.toLowerCase() === 'card');
          if (card) {
            setCardLocalEnabled(card.is_enabled);
            try {
              const p = JSON.parse(card.parameters);
              if (typeof p.requireTrace === 'boolean') setRequireEdcTraceCode(p.requireTrace);
              if (Array.isArray(p.acceptedCards) && p.acceptedCards.length > 0) setAcceptedCards(p.acceptedCards);
            } catch {
              // Ignore parse error, keep defaults
            }
          }

          const midtrans = fullDrafts.find((d) => d.rail_code.toLowerCase() === 'midtrans');
          if (midtrans) {
            setMidtransLocalEnabled(midtrans.is_enabled);
            try {
              const p = JSON.parse(midtrans.parameters);
              if (p.env === 'sandbox' || p.env === 'production') setMidtransEnv(p.env);
              if (p.merchantId) setMidtransMerchantId(p.merchantId);
              if (p.clientKey) setMidtransClientKey(p.clientKey);
              if (p.serverKey) setMidtransServerKey(p.serverKey);
              if (p.channels && typeof p.channels === 'object') setMidtransChannels(p.channels);
              if (typeof p.autoConfirm === 'boolean') setMidtransAutoConfirm(p.autoConfirm);
            } catch {
              // Ignore parse error, keep defaults
            }
          }

          const stripe = fullDrafts.find((d) => d.rail_code.toLowerCase() === 'stripe');
          if (stripe) {
            setStripeLocalEnabled(stripe.is_enabled);
            try {
              const p = JSON.parse(stripe.parameters);
              if (p.mode === 'test' || p.mode === 'live') setStripeMode(p.mode);
              if (p.publishableKey) setStripePublishableKey(p.publishableKey);
              if (p.secretKey) setStripeSecretKey(p.secretKey);
              if (p.reader) setStripeReader(p.reader);
              if (p.currency) setStripeCurrency(p.currency);
            } catch {
              // Ignore parse error, keep defaults
            }
          }

          // Load payment gateway credentials (stored separately in payment_gateways)
          try {
            const [midtransGw, stripeGw] = await Promise.all([
              getPaymentGatewayConfigScoped(sessionToken, 'midtrans').catch(() => null),
              getPaymentGatewayConfigScoped(sessionToken, 'stripe').catch(() => null),
            ]);
            if (midtransGw) {
              setMidtransLocalEnabled(midtransGw.isActive);
              try {
                const p = JSON.parse(midtransGw.configJson);
                if (p.env === 'sandbox' || p.env === 'production') setMidtransEnv(p.env);
                if (p.merchantId) setMidtransMerchantId(p.merchantId);
                if (p.clientKey) setMidtransClientKey(p.clientKey);
                if (p.serverKey) setMidtransServerKey(p.serverKey);
              } catch {
                // Ignore parse error
              }
            }
            if (stripeGw) {
              setStripeLocalEnabled(stripeGw.isActive);
              try {
                const p = JSON.parse(stripeGw.configJson);
                if (p.mode === 'test' || p.mode === 'live') setStripeMode(p.mode);
                if (p.publishableKey) setStripePublishableKey(p.publishableKey);
                if (p.secretKey) setStripeSecretKey(p.secretKey);
              } catch {
                // Ignore parse error
              }
            }
          } catch {
            // Ignore error
          }
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
    if (loading || !originalsRef.current.drafts || originalsRef.current.drafts.length === 0) {
      return false;
    }
    return computeRailsDirty(
      originalsRef.current.drafts,
      drafts,
      originalsRef.current.defaultEdcTerminalId,
      defaultEdcTerminalId,
    );
  }, [loading, drafts, defaultEdcTerminalId, dirtyVersion]);

  // ── Helper to update rail parameters safely ───────────────────────
  const updateRailParams = useCallback((code: string, newParams: Record<string, unknown>) => {
    const lower = code.toLowerCase();
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.rail_code.toLowerCase() === lower);
      if (idx >= 0) {
        return prev.map((d, i) => {
          if (i !== idx) return d;
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(d.parameters);
          } catch {
            parsed = {};
          }
          const merged = { ...parsed, ...newParams };
          return { ...d, parameters: JSON.stringify(merged) };
        });
      }
      const labelMap: Record<string, string> = {
        cash: 'Cash',
        qris: 'QRIS',
        card: 'Card / EDC Terminal',
        midtrans: 'Midtrans Gateway',
        stripe: 'Stripe Processing',
      };
      return [
        ...prev,
        {
          rail_code: lower,
          label: labelMap[lower] || code,
          is_enabled: false,
          parameters: JSON.stringify(newParams),
        },
      ];
    });
  }, []);

  const updateRailLabel = useCallback((code: string, label: string) => {
    const lower = code.toLowerCase();
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.rail_code.toLowerCase() === lower);
      if (idx >= 0) {
        return prev.map((d, i) => (i === idx ? { ...d, label } : d));
      }
      return [
        ...prev,
        {
          rail_code: lower,
          label,
          is_enabled: false,
          parameters: '{}',
        },
      ];
    });
  }, []);

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
    const lower = code.toLowerCase();
    if (lower === 'cash') setCashLocalEnabled(checked);
    if (lower === 'qris') setQrisLocalEnabled(checked);
    if (lower === 'card') setCardLocalEnabled(checked);
    if (lower === 'midtrans') setMidtransLocalEnabled(checked);
    if (lower === 'stripe') setStripeLocalEnabled(checked);

    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.rail_code.toLowerCase() === lower);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx]!, is_enabled: checked };
        return copy;
      }
      const labelMap: Record<string, string> = {
        cash: 'Cash',
        qris: 'QRIS',
        card: 'Card / EDC Terminal',
        midtrans: 'Midtrans Gateway',
        stripe: 'Stripe Processing',
      };
      return [
        ...prev,
        {
          rail_code: lower,
          label: labelMap[lower] || code,
          is_enabled: checked,
          parameters: '{}',
        },
      ];
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

  const handleRemoveRail = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddCustomRail = () => {
    const sanitized = sanitizeRailCode(newRailCode);
    if (!sanitized) {
      addToast({
        message: l10n.getString('settings-localpay-code-placeholder') || 'Payment method code is required',
        type: 'warning',
      });
      return;
    }
    const label = newRailLabel.trim() || sanitized.toUpperCase();
    if (drafts.some((d) => d.rail_code.toLowerCase() === sanitized)) {
      addToast({
        message: 'A payment method with this code already exists',
        type: 'warning',
      });
      return;
    }
    setDrafts((prev) => [
      ...prev,
      {
        rail_code: sanitized,
        label,
        is_enabled: true,
        parameters: '{}',
      },
    ]);
    setNewRailCode('');
    setNewRailLabel('');
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
      // Sanitize parameters so credentials are never stored in market rails
      const payload: LocalPaymentRailArgs[] = drafts.map((d) => {
        const lower = d.rail_code.toLowerCase();
        let paramsObj: Record<string, unknown> = {};
        try {
          paramsObj = JSON.parse(d.parameters);
        } catch {
          paramsObj = {};
        }

        if (lower === 'midtrans') {
          const clean: Record<string, unknown> = {};
          if (paramsObj['channels']) clean['channels'] = paramsObj['channels'];
          if (typeof paramsObj['autoConfirm'] === 'boolean') clean['autoConfirm'] = paramsObj['autoConfirm'];
          return {
            rail_code: d.rail_code,
            label: d.label,
            is_enabled: d.is_enabled,
            parameters: JSON.stringify(clean),
          };
        }

        if (lower === 'stripe') {
          const clean: Record<string, unknown> = {};
          if (paramsObj['reader']) clean['reader'] = paramsObj['reader'];
          if (paramsObj['currency']) clean['currency'] = paramsObj['currency'];
          return {
            rail_code: d.rail_code,
            label: d.label,
            is_enabled: d.is_enabled,
            parameters: JSON.stringify(clean),
          };
        }

        return {
          rail_code: d.rail_code,
          label: d.label,
          is_enabled: d.is_enabled,
          parameters: d.parameters,
        };
      });
      tasks.push(setLocalPaymentMethodsScoped(sessionToken, locationId, payload));

      // 2. Save payment gateway credentials (encrypted at rest in payment_gateways)
      tasks.push(
        setPaymentGatewayConfigScoped(sessionToken, {
          gatewayName: 'midtrans',
          isActive: midtransLocalEnabled,
          configJson: JSON.stringify({
            merchantId: midtransMerchantId,
            clientKey: midtransClientKey,
            serverKey: midtransServerKey,
            env: midtransEnv,
          }),
        }),
      );

      tasks.push(
        setPaymentGatewayConfigScoped(sessionToken, {
          gatewayName: 'stripe',
          isActive: stripeLocalEnabled,
          configJson: JSON.stringify({
            publishableKey: stripePublishableKey,
            secretKey: stripeSecretKey,
            mode: stripeMode,
          }),
        }),
      );

      // 3. Save hardware EDC default terminal preference
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
    midtransLocalEnabled,
    midtransMerchantId,
    midtransClientKey,
    midtransServerKey,
    midtransEnv,
    stripeLocalEnabled,
    stripePublishableKey,
    stripeSecretKey,
    stripeMode,
    onSaved,
    addToast,
    l10n,
  ]);

  // ── Back Navigation Guard with Unsaved Dialog ───────────────
  const handleRequestBack = useCallback(() => {
    if (dirty) {
      setShowUnsavedDialog(true);
    } else {
      onBack?.();
    }
  }, [dirty, onBack]);

  useEffect(() => {
    if (!onBack) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      handleRequestBack();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onBack, handleRequestBack]);

  // Find drafts for the 5 targeted payment methods
  const cashDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'cash');
  const cardDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'card');
  const qrisDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'qris');
  const midtransDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'midtrans');
  const stripeDraft = drafts.find((d) => d.rail_code.toLowerCase() === 'stripe');

  const staticQrValue = qrisDraft ? readStaticQrPayload(qrisDraft.parameters) ?? '' : '';

  // Non-specialized payment methods (e.g. custom methods like gopay, excluding internal open_bill/credit)
  // Codes with a DEDICATED card above (or a gateway card), so they must not also
  // appear in the Other-Rails list.
  //
  // ⚠️ `open_bill` and `credit` are deliberately ABSENT from both lists, and that is
  // the fix rather than a simplification. `CORE_RAIL_CODES`
  // (`paymentRailsLogic.ts:11`) names five non-removable rails — cash, card, qris,
  // open_bill, credit — but this screen rendered dedicated cards for only three of
  // them, and the `internalHiddenCodes` list below excluded the other two from the
  // Other-Rails list as well. So both rendered NOWHERE: no card, no row, no hint they
  // existed. The operator could not see or switch either one.
  //
  // That is worse than a toggle that does nothing (F16): a dead toggle is at least
  // visible. And it stopped being cosmetic in round 52, when the charge modal began
  // HONOURING the open_bill flag (`coreRailWithheld`) — so the tender appears at
  // checkout with no way to switch it off from the screen that owns it.
  //
  // Two codes have dedicated cards (cash/qris) or gateway cards (midtrans/stripe);
  // everything else belongs in the Other-Rails list, which is already core-aware — it
  // badges a core rail "Core Method" and withholds the remove button via `isCoreRail`.
  const specializedCodes = ['cash', 'card', 'qris', 'midtrans', 'stripe'];
  const otherRails = drafts.filter(
    (d) => !specializedCodes.includes(d.rail_code.toLowerCase()),
  );

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header" data-testid="restaurant-payments-header">
        <div className="restaurant-settings-header-lead">
          {onBack && (
            <button
              type="button"
              className="restaurant-settings-back-btn"
              onClick={handleRequestBack}
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
              enabled={cashDraft ? cashDraft.is_enabled : cashLocalEnabled}
              onToggle={(enabled) => handleToggleCode('cash', enabled)}
              isCore={true}
            >
              <div className="resto-compact-form">
                <div className="resto-compact-row">
                  <span className="resto-compact-label">Display Label</span>
                  <div className="resto-compact-control">
                    <input
                      id="cash-custom-label"
                      type="text"
                      className="settings-input"
                      value={cashCustomLabel}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCashCustomLabel(val);
                        updateRailLabel('cash', val);
                      }}
                      placeholder="Cash"
                      aria-label="Display Label"
                      data-testid="cash-custom-label-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Automatic Cash Drawer</span>
                  <div className="resto-compact-control">
                    <span className="settings-toggle">
                      <label className="settings-toggle-switch" htmlFor="cash-drawer-kick">
                        <input
                          id="cash-drawer-kick"
                          type="checkbox"
                          role="switch"
                          checked={cashDrawerAutoKick}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setCashDrawerAutoKick(val);
                            updateRailParams('cash', { autoKick: val });
                          }}
                          aria-label="Automatic Cash Drawer"
                          data-testid="cash-drawer-kick-toggle"
                        />
                        <span className="settings-toggle-slider" aria-hidden="true" />
                      </label>
                    </span>
                  </div>
                </div>

                <div className="resto-compact-block">
                  <span className="resto-compact-block-title">Cash Suggestion Presets</span>
                  <div className="resto-compact-chips">
                    {['exact', '1000', '2000', '5000', '10000', '20000', '50000', '100000'].map((preset) => {
                      const active = activeCashPresets.some((p) => p.toLowerCase() === preset.toLowerCase());
                      return (
                        <button
                          key={preset}
                          type="button"
                          className={`resto-compact-chip ${active ? 'resto-compact-chip--active' : ''}`}
                          onClick={() => {
                            const next = active
                              ? activeCashPresets.filter((p) => p.toLowerCase() !== preset.toLowerCase())
                              : [...activeCashPresets, preset];
                            setActiveCashPresets(next);
                            updateRailParams('cash', { presets: next });
                          }}
                          aria-pressed={active}
                          data-testid={`cash-preset-${preset.toLowerCase().replace('.', '')}`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Cashier Drawer Verification</span>
                  <div className="resto-compact-control">
                    <span className="settings-toggle">
                      <label className="settings-toggle-switch" htmlFor="cash-drawer-verify">
                        <input
                          id="cash-drawer-verify"
                          type="checkbox"
                          role="switch"
                          checked={cashDrawerVerify}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setCashDrawerVerify(val);
                            updateRailParams('cash', { verifyDrawer: val });
                          }}
                          aria-label="Cashier Drawer Verification"
                          data-testid="cash-drawer-verify-toggle"
                        />
                        <span className="settings-toggle-slider" aria-hidden="true" />
                      </label>
                    </span>
                  </div>
                </div>
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
              enabled={qrisDraft ? qrisDraft.is_enabled : qrisLocalEnabled}
              onToggle={(enabled) => handleToggleCode('qris', enabled)}
              isCore={true}
              mountBodyWhenCollapsed={false}
            >
              <div className="resto-compact-form">
                <div className="resto-compact-row">
                  <span className="resto-compact-label">Mode</span>
                  <div className="resto-compact-control">
                    <div className="resto-segmented-group" role="group" aria-label="QR Mode">
                      <button
                        type="button"
                        className={`resto-segmented-btn ${qrisMode === 'static' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setQrisMode('static');
                          updateRailParams('qris', { mode: 'static' });
                        }}
                        data-testid="qris-mode-static"
                      >
                        Static
                      </button>
                      <button
                        type="button"
                        className={`resto-segmented-btn ${qrisMode === 'dynamic' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setQrisMode('dynamic');
                          updateRailParams('qris', { mode: 'dynamic' });
                        }}
                        data-testid="qris-mode-dynamic"
                      >
                        Dynamic
                      </button>
                    </div>
                  </div>
                </div>

                <div className="resto-compact-block">
                  <label htmlFor="resto-static-qris" className="resto-compact-block-title">
                    <Localized id="settings-localpay-static-qr-label">Static QR payload (EMVCo string)</Localized>
                  </label>
                  <div className="restaurant-static-qr-box">
                    <textarea
                      id="resto-static-qris"
                      className="settings-input"
                      rows={2}
                      placeholder="00020101021126580014ID.LINKAJA.WWW0118936009110022201389..."
                      value={staticQrValue}
                      onChange={(e) => handleStaticQrChange(e.target.value)}
                      aria-label="Static QR payload (EMVCo string)"
                      spellCheck={false}
                      data-testid="qris-static-payload-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="qris-nmid" className="resto-compact-label">
                    Merchant NMID
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="qris-nmid"
                      type="text"
                      className="settings-input"
                      value={qrisNmid}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQrisNmid(val);
                        updateRailParams('qris', { nmid: val });
                      }}
                      placeholder="ID1020030040050"
                      data-testid="qris-nmid-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="qris-surcharge" className="resto-compact-label">
                    MDR Fee (%)
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="qris-surcharge"
                      type="text"
                      className="settings-input"
                      value={qrisSurcharge}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQrisSurcharge(val);
                        updateRailParams('qris', { surcharge: val });
                      }}
                      placeholder="0.7"
                      data-testid="qris-surcharge-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Print Pay-at-Table QR</span>
                  <div className="resto-compact-control">
                    <span className="settings-toggle">
                      <label className="settings-toggle-switch" htmlFor="qris-print-bill">
                        <input
                          id="qris-print-bill"
                          type="checkbox"
                          role="switch"
                          checked={qrisPrintReceipt}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setQrisPrintReceipt(val);
                            updateRailParams('qris', { printReceipt: val });
                          }}
                          aria-label="Print Pay-at-Table QR"
                          data-testid="qris-print-bill-toggle"
                        />
                        <span className="settings-toggle-slider" aria-hidden="true" />
                      </label>
                    </span>
                  </div>
                </div>
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
              enabled={cardDraft ? cardDraft.is_enabled : cardLocalEnabled}
              onToggle={(enabled) => handleToggleCode('card', enabled)}
              isCore={true}
              mountBodyWhenCollapsed={true}
            >
              <div className="resto-compact-form">
                <div className="resto-compact-row">
                  <label htmlFor="resto-default-edc" className="resto-compact-label">
                    <Localized id="settings-edc-default-select">Default EDC</Localized>
                  </label>
                  <div className="resto-compact-control">
                    <SettingsSelect
                      id="resto-default-edc"
                      data-testid="edc-default-select"
                      value={defaultEdcTerminalId}
                      onChange={(v: string) => {
                        setDefaultEdcTerminalId(v);
                        updateRailParams('card', { defaultTerminalId: v });
                      }}
                      options={[
                        { value: '', label: 'None (Manual Card Entry)' },
                        ...edcTerminals.map((t) => ({
                          value: t.id,
                          label: `${t.name} (${t.transport} - ${t.address})`,
                        })),
                      ]}
                    />
                    {defaultEdcTerminalId && (
                      <button
                        type="button"
                        className="resto-compact-btn"
                        onClick={handleTestEdc}
                        disabled={testingEdc}
                        data-testid="edc-test-connection-btn"
                      >
                        <Localized id="settings-edc-test">Test Connection</Localized>
                      </button>
                    )}
                  </div>
                </div>

                <div className="resto-compact-block">
                  <span className="resto-compact-block-title">Supported Card Networks</span>
                  <div className="resto-compact-chips">
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
                          className={`resto-compact-chip ${active ? 'resto-compact-chip--active' : ''}`}
                          onClick={() => {
                            const next = active
                              ? acceptedCards.filter((id) => id !== network.id)
                              : [...acceptedCards, network.id];
                            setAcceptedCards(next);
                            updateRailParams('card', { acceptedCards: next });
                          }}
                          aria-pressed={active}
                          data-testid={`card-network-${network.id}`}
                        >
                          {network.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Require Approval Code</span>
                  <div className="resto-compact-control">
                    <span className="settings-toggle">
                      <label className="settings-toggle-switch" htmlFor="edc-require-trace">
                        <input
                          id="edc-require-trace"
                          type="checkbox"
                          role="switch"
                          checked={requireEdcTraceCode}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setRequireEdcTraceCode(val);
                            updateRailParams('card', { requireTrace: val });
                          }}
                          aria-label="Require Approval Code"
                          data-testid="edc-require-trace-toggle"
                        />
                        <span className="settings-toggle-slider" aria-hidden="true" />
                      </label>
                    </span>
                  </div>
                </div>
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
              isCore={true}
            >
              <div className="resto-compact-form">
                <div className="resto-compact-row">
                  <span className="resto-compact-label">Environment</span>
                  <div className="resto-compact-control">
                    <div className="resto-segmented-group" role="group" aria-label="Midtrans Environment">
                      <button
                        type="button"
                        className={`resto-segmented-btn ${midtransEnv === 'sandbox' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setMidtransEnv('sandbox');
                          updateRailParams('midtrans', { env: 'sandbox' });
                        }}
                        data-testid="midtrans-env-sandbox"
                      >
                        Sandbox
                      </button>
                      <button
                        type="button"
                        className={`resto-segmented-btn ${midtransEnv === 'production' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setMidtransEnv('production');
                          updateRailParams('midtrans', { env: 'production' });
                        }}
                        data-testid="midtrans-env-production"
                      >
                        Production
                      </button>
                    </div>
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="midtrans-merchant-id" className="resto-compact-label">
                    Merchant ID
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="midtrans-merchant-id"
                      type="text"
                      className="settings-input"
                      value={midtransMerchantId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMidtransMerchantId(val);
                        updateRailParams('midtrans', { merchantId: val });
                      }}
                      placeholder="G123456789"
                      data-testid="midtrans-merchant-id-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="midtrans-client-key" className="resto-compact-label">
                    Client Key
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="midtrans-client-key"
                      type="text"
                      className="settings-input"
                      value={midtransClientKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMidtransClientKey(val);
                        updateRailParams('midtrans', { clientKey: val });
                      }}
                      placeholder="SB-Mid-client-XXXXX"
                      data-testid="midtrans-client-key-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="midtrans-server-key" className="resto-compact-label">
                    Server Key
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="midtrans-server-key"
                      type="password"
                      className="settings-input"
                      value={midtransServerKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMidtransServerKey(val);
                        updateRailParams('midtrans', { serverKey: val });
                      }}
                      placeholder="SB-Mid-server-XXXXX"
                      data-testid="midtrans-server-key-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-block">
                  <span className="resto-compact-block-title">Payment Channels</span>
                  <div className="resto-compact-chips">
                    {[
                      { key: 'gopay', label: 'GoPay / QRIS' },
                      { key: 'shopeepay', label: 'ShopeePay' },
                      { key: 'bca_va', label: 'BCA VA' },
                      { key: 'mandiri_va', label: 'Mandiri' },
                      { key: 'bni_va', label: 'BNI VA' },
                      { key: 'bri_va', label: 'BRI VA' },
                    ].map((ch) => {
                      const active = Boolean(midtransChannels[ch.key]);
                      return (
                        <button
                          key={ch.key}
                          type="button"
                          className={`resto-compact-chip ${active ? 'resto-compact-chip--active' : ''}`}
                          onClick={() => {
                            const next = { ...midtransChannels, [ch.key]: !midtransChannels[ch.key] };
                            setMidtransChannels(next);
                            updateRailParams('midtrans', { channels: next });
                          }}
                          aria-pressed={active}
                          data-testid={`midtrans-channel-${ch.key}`}
                        >
                          {ch.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Instant Webhook</span>
                  <div className="resto-compact-control">
                    <span className="settings-toggle">
                      <label className="settings-toggle-switch" htmlFor="midtrans-auto-confirm">
                        <input
                          id="midtrans-auto-confirm"
                          type="checkbox"
                          role="switch"
                          checked={midtransAutoConfirm}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setMidtransAutoConfirm(val);
                            updateRailParams('midtrans', { autoConfirm: val });
                          }}
                          aria-label="Instant Webhook"
                          data-testid="midtrans-auto-confirm-toggle"
                        />
                        <span className="settings-toggle-slider" aria-hidden="true" />
                      </label>
                    </span>
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Connection</span>
                  <div className="resto-compact-control">
                    <button
                      type="button"
                      className="resto-compact-btn"
                      onClick={() => {
                        const isConfigured = Boolean(midtransClientKey && midtransServerKey);
                        addToast({
                          message: isConfigured
                            ? `Midtrans credentials format verified (${midtransEnv.toUpperCase()})`
                            : 'Please enter Client Key and Server Key',
                          type: isConfigured ? 'success' : 'warning',
                        });
                      }}
                      data-testid="midtrans-test-api-btn"
                    >
                      Test API Keys
                    </button>
                  </div>
                </div>
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
              isCore={true}
            >
              <div className="resto-compact-form">
                <div className="resto-compact-row">
                  <span className="resto-compact-label">Mode</span>
                  <div className="resto-compact-control">
                    <div className="resto-segmented-group" role="group" aria-label="Stripe Mode">
                      <button
                        type="button"
                        className={`resto-segmented-btn ${stripeMode === 'test' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setStripeMode('test');
                          updateRailParams('stripe', { mode: 'test' });
                        }}
                        data-testid="stripe-mode-test"
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className={`resto-segmented-btn ${stripeMode === 'live' ? 'resto-segmented-btn--active' : ''}`}
                        onClick={() => {
                          setStripeMode('live');
                          updateRailParams('stripe', { mode: 'live' });
                        }}
                        data-testid="stripe-mode-live"
                      >
                        Live
                      </button>
                    </div>
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="stripe-pub-key" className="resto-compact-label">
                    Publishable Key
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="stripe-pub-key"
                      type="text"
                      className="settings-input"
                      value={stripePublishableKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStripePublishableKey(val);
                        updateRailParams('stripe', { publishableKey: val });
                      }}
                      placeholder="pk_test_51..."
                      data-testid="stripe-pub-key-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="stripe-sec-key" className="resto-compact-label">
                    Secret Key
                  </label>
                  <div className="resto-compact-control">
                    <input
                      id="stripe-sec-key"
                      type="password"
                      className="settings-input"
                      value={stripeSecretKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStripeSecretKey(val);
                        updateRailParams('stripe', { secretKey: val });
                      }}
                      placeholder="sk_test_51..."
                      data-testid="stripe-sec-key-input"
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="stripe-reader" className="resto-compact-label">
                    Card Reader
                  </label>
                  <div className="resto-compact-control">
                    <SettingsSelect
                      id="stripe-reader"
                      data-testid="stripe-reader-select"
                      value={stripeReader}
                      onChange={(v: string) => {
                        setStripeReader(v);
                        updateRailParams('stripe', { reader: v });
                      }}
                      options={[
                        { value: 'wisepos_e', label: 'BBPOS WisePOS E (Wi-Fi)' },
                        { value: 'reader_s700', label: 'Stripe Reader S700' },
                        { value: 'tap_to_pay', label: 'Tap to Pay (NFC)' },
                      ]}
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <label htmlFor="stripe-currency" className="resto-compact-label">
                    Currency
                  </label>
                  <div className="resto-compact-control">
                    <SettingsSelect
                      id="stripe-currency"
                      data-testid="stripe-currency-select"
                      value={stripeCurrency}
                      onChange={(v: string) => {
                        setStripeCurrency(v);
                        updateRailParams('stripe', { currency: v });
                      }}
                      options={[
                        { value: 'IDR', label: 'IDR - Indonesian Rupiah' },
                        { value: 'USD', label: 'USD - US Dollar' },
                        { value: 'SGD', label: 'SGD - Singapore Dollar' },
                        { value: 'EUR', label: 'EUR - Euro' },
                      ]}
                    />
                  </div>
                </div>

                <div className="resto-compact-row">
                  <span className="resto-compact-label">Connection</span>
                  <div className="resto-compact-control">
                    <button
                      type="button"
                      className="resto-compact-btn"
                      onClick={() => {
                        const isConfigured = Boolean(stripePublishableKey && stripeSecretKey);
                        addToast({
                          message: isConfigured
                            ? `Stripe keys format valid (${stripeMode.toUpperCase()})`
                            : 'Please enter Publishable Key and Secret Key',
                          type: isConfigured ? 'success' : 'warning',
                        });
                      }}
                      data-testid="stripe-verify-keys-btn"
                    >
                      Verify Keys
                    </button>
                  </div>
                </div>
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
                  badge={isCore ? 'Core Method' : 'Custom Method'}
                  badgeVariant={isCore ? 'default' : 'warning'}
                  icon={<GenericRailIcon />}
                  enabled={rail.is_enabled}
                  onToggle={(enabled) => handleToggleRail(railIndex, enabled)}
                  isCore={isCore}
                  onRemove={!isCore ? () => handleRemoveRail(railIndex) : undefined}
                  removeAriaLabel={`Remove ${rail.label}`}
                >
                  <p className="settings-hint">
                    Active tender method ready for cashier checkout and receipt attribution.
                  </p>
                </PaymentMethodCard>
              );
            })}

            {/* ── Add Custom Payment Method ── */}
            <div className="resto-payment-card-wrapper" data-testid="add-custom-rail-card">
              <div className="resto-payment-card resto-payment-card--expanded">
                <div className="restaurant-settings-card-header resto-payment-card-header">
                  <div className="resto-payment-card-title-group">
                    <span className="restaurant-settings-header-icon" aria-hidden="true">
                      <GenericRailIcon />
                    </span>
                    <span className="resto-payment-card-title">
                      <Localized id="settings-localpay-add">Add Custom Payment Method</Localized>
                    </span>
                  </div>
                </div>
                <div className="resto-payment-card-body">
                  <div className="resto-compact-form">
                    <div className="resto-compact-row">
                      <label htmlFor="new-rail-code" className="resto-compact-label">
                        <Localized id="settings-localpay-code-label">Method Code</Localized>
                      </label>
                      <div className="resto-compact-control">
                        <input
                          id="new-rail-code"
                          type="text"
                          className="settings-input"
                          value={newRailCode}
                          onChange={(e) => setNewRailCode(e.target.value)}
                          placeholder="e.g. ovo, shopeepay, voucher"
                          data-testid="new-rail-code-input"
                        />
                      </div>
                    </div>
                    <div className="resto-compact-row">
                      <label htmlFor="new-rail-label" className="resto-compact-label">
                        <Localized id="settings-localpay-label-label">Display Name</Localized>
                      </label>
                      <div className="resto-compact-control">
                        <input
                          id="new-rail-label"
                          type="text"
                          className="settings-input"
                          value={newRailLabel}
                          onChange={(e) => setNewRailLabel(e.target.value)}
                          placeholder="e.g. OVO Wallet"
                          data-testid="new-rail-label-input"
                        />
                      </div>
                    </div>
                    <div className="resto-compact-row">
                      <span className="resto-compact-label" />
                      <div className="resto-compact-control">
                        <button
                          type="button"
                          className="btn btn--primary btn--md"
                          onClick={() => handleAddCustomRail()}
                          disabled={!newRailCode.trim()}
                          data-testid="add-custom-rail-btn"
                        >
                          <Localized id="settings-localpay-add">Add Method</Localized>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onCancel={() => setShowUnsavedDialog(false)}
        onDiscard={() => {
          setShowUnsavedDialog(false);
          onBack?.();
        }}
        onSave={async () => {
          await handleSave();
          setShowUnsavedDialog(false);
        }}
        saving={saving}
      />
    </div>
  );
}

export default RestaurantPaymentsScreen;
