import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { setReceiptSettingsScoped, setUserPreferencesScoped, getUserPreferencesScoped } from '@/api/settings';
import { printSalesReceipt } from '@/api/sales';
import SettingsSelect from '@/features/settings/SettingsSelect';
import './RestaurantSettingsScreens.css';

const FALLBACK_SETTINGS = {
  receipt: {
    showCurrency: false,
    decimalSeparator: 'dot',
    showTax: true,
    footer: '',
    paperWidth: 'standard',
    showTableNumber: false,
    marginTop: 5,
    marginBottom: 8,
    marginLeft: 3,
    marginRight: 3,
    taxRoundingMode: 'half_up',
  },
  store: { name: '', address: '', taxId: '', currency: 'IDR', branch: '', logo: '' },
};

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, isNaN(val) ? min : val));

export interface RestaurantReceiptsScreenProps {
  terminalId?: string;
  onSaved?: () => void;
  onBack?: () => void;
}

export default function RestaurantReceiptsScreen({
  terminalId: propTerminalId,
  onSaved,
}: RestaurantReceiptsScreenProps) {
  const settingsCtx = useOptionalSettings();
  const settings = settingsCtx?.settings ?? FALLBACK_SETTINGS;
  const markSettingsUpdated = settingsCtx?.markSettingsUpdated;
  const { sessionToken, terminalId: contextTerminalId } = useWorkspace();
  const { caps } = useSubscription();
  const { session } = useAuth();
  const effectiveTerminalId = propTerminalId || contextTerminalId || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(effectiveTerminalId, settings.store.currency);

  const isFreeTier = !caps || caps.tier === 'free';
  const staffDisplayName = session?.display_name || 'Budi S.';

  // ── Receipt format draft state ──────────────────────────────
  const [paperWidth, setPaperWidth] = useState<'standard' | 'narrow'>('standard');
  const [showCurrency, setShowCurrency] = useState(false);
  const [showTableNumber, setShowTableNumber] = useState(false);
  const [taxRoundingMode, setTaxRoundingMode] = useState<'half_up' | 'truncate'>('half_up');
  const [footer, setFooter] = useState('');

  // ── New Toggles ─────────────────────────────────────────────
  const [showReceiptCode, setShowReceiptCode] = useState(true);
  const [showDateTime, setShowDateTime] = useState(true);
  const [showStaffName, setShowStaffName] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [showTax, setShowTax] = useState(true);
  const [taxRatePercent, setTaxRatePercent] = useState(10);
  const [businessLogo, setBusinessLogo] = useState<string>('');

  // ── Paper margins state (mm) ────────────────────────────────
  const [marginTop, setMarginTop] = useState(5);
  const [marginBottom, setMarginBottom] = useState(8);
  const [marginLeft, setMarginLeft] = useState(3);
  const [marginRight, setMarginRight] = useState(3);

  // ── Printer device draft state ──────────────────────────────
  const [printerConnection, setPrinterConnection] = useState<'auto' | 'network' | 'usb' | 'serial' | 'disabled'>('auto');
  const [printerDevicePath, setPrinterDevicePath] = useState('');
  const [printerPaperSize, setPrinterPaperSize] = useState<'80' | '58'>('80');
  const [kitchenConnection, setKitchenConnection] = useState<'disabled' | 'network' | 'usb' | 'serial' | 'auto'>('disabled');
  const [kitchenDevicePath, setKitchenDevicePath] = useState('');

  const [saving, setSaving] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track originals for dirty state
  const originalsRef = useRef<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const receiptInitializedRef = useRef(false);
  const hwInitializedRef = useRef(false);

  // Initialize receipt settings from workspace context and stored preferences
  useEffect(() => {
    if (receiptInitializedRef.current) return;
    setPaperWidth(settings.receipt.paperWidth === 'narrow' ? 'narrow' : 'standard');
    setShowCurrency(settings.receipt.showCurrency);
    setShowTax(settings.receipt.showTax);
    setShowTableNumber(settings.receipt.showTableNumber);
    setTaxRoundingMode((settings.receipt.taxRoundingMode as 'half_up' | 'truncate') ?? 'half_up');
    setFooter(settings.receipt.footer ?? '');
    setMarginTop(settings.receipt.marginTop > 0 ? settings.receipt.marginTop : 5);
    setMarginBottom(settings.receipt.marginBottom > 0 ? settings.receipt.marginBottom : 8);
    setMarginLeft(settings.receipt.marginLeft > 0 ? settings.receipt.marginLeft : 3);
    setMarginRight(settings.receipt.marginRight > 0 ? settings.receipt.marginRight : 3);
    if (settings.store.logo) {
      setBusinessLogo(settings.store.logo);
    }

    // Load extra toggles from local preferences
    try {
      const localCode = localStorage.getItem('resto_rcpt_show_code');
      if (localCode !== null) setShowReceiptCode(localCode === 'true');
      const localDt = localStorage.getItem('resto_rcpt_show_dt');
      if (localDt !== null) setShowDateTime(localDt === 'true');
      const localStaff = localStorage.getItem('resto_rcpt_show_staff');
      if (localStaff !== null) setShowStaffName(localStaff === 'true');
      const localFooter = localStorage.getItem('resto_rcpt_show_footer');
      if (localFooter !== null) setShowFooter(localFooter === 'true');
      const localTaxRate = localStorage.getItem('resto_rcpt_tax_rate');
      if (localTaxRate !== null && !isNaN(Number(localTaxRate))) {
        setTaxRatePercent(clamp(Number(localTaxRate), 0, 100));
      }
      const localLogo = localStorage.getItem('resto_rcpt_logo');
      if (localLogo) setBusinessLogo(localLogo);
    } catch {
      // LocalStorage unavailable, keep defaults
    }

    // Attempt remote user preferences read
    if (sessionToken) {
      getUserPreferencesScoped(sessionToken)
        .then((prefs) => {
          const p = prefs as Record<string, string | undefined>;
          if (p['resto_rcpt_show_code'] !== undefined) {
            setShowReceiptCode(p['resto_rcpt_show_code'] === 'true');
          }
          if (p['resto_rcpt_show_dt'] !== undefined) {
            setShowDateTime(p['resto_rcpt_show_dt'] === 'true');
          }
          if (p['resto_rcpt_show_staff'] !== undefined) {
            setShowStaffName(p['resto_rcpt_show_staff'] === 'true');
          }
          if (p['resto_rcpt_show_footer'] !== undefined) {
            setShowFooter(p['resto_rcpt_show_footer'] === 'true');
          }
          if (p['resto_rcpt_tax_rate'] !== undefined) {
            const parsed = Number(p['resto_rcpt_tax_rate']);
            if (!isNaN(parsed)) setTaxRatePercent(clamp(parsed, 0, 100));
          }
          if (p['resto_rcpt_logo']) {
            setBusinessLogo(p['resto_rcpt_logo']);
          }
        })
        .catch(() => {
          // Fall back gracefully
        });
    }

    receiptInitializedRef.current = true;
  }, [settings.receipt, settings.store.logo, sessionToken]);

  // Sync hardware settings when profile arrives
  useEffect(() => {
    if (hwInitializedRef.current || !hw.profile) return;
    const p = hw.profile.hardware.printer;
    const kp = hw.profile.hardware.kitchenPrinter;
    setPrinterConnection(p.connection);
    setPrinterDevicePath(p.devicePath ?? '');
    setPrinterPaperSize(p.paperSize === '58' ? '58' : '80');
    setKitchenConnection(kp.connection);
    setKitchenDevicePath(kp.devicePath ?? '');

    originalsRef.current = {
      ...originalsRef.current,
      printerConnection: p.connection,
      printerDevicePath: p.devicePath ?? '',
      printerPaperSize: p.paperSize ?? '80',
      kitchenConnection: kp.connection,
      kitchenDevicePath: kp.devicePath ?? '',
    };
    hwInitializedRef.current = true;
    setDirtyVersion((v) => v + 1);
  }, [hw.profile]);

  // Seed initial originals for clean dirty checking
  useEffect(() => {
    if (!loaded) {
      originalsRef.current = {
        paperWidth: settings.receipt.paperWidth === 'narrow' ? 'narrow' : 'standard',
        showCurrency: settings.receipt.showCurrency,
        showTax: settings.receipt.showTax,
        showTableNumber: settings.receipt.showTableNumber,
        taxRoundingMode: settings.receipt.taxRoundingMode ?? 'half_up',
        footer: settings.receipt.footer ?? '',
        showReceiptCode: true,
        showDateTime: true,
        showStaffName: true,
        showFooter: true,
        taxRatePercent: 10,
        businessLogo: settings.store.logo ?? '',
        marginTop: settings.receipt.marginTop > 0 ? settings.receipt.marginTop : 5,
        marginBottom: settings.receipt.marginBottom > 0 ? settings.receipt.marginBottom : 8,
        marginLeft: settings.receipt.marginLeft > 0 ? settings.receipt.marginLeft : 3,
        marginRight: settings.receipt.marginRight > 0 ? settings.receipt.marginRight : 3,
        printerConnection: hw.profile?.hardware.printer.connection ?? 'auto',
        printerDevicePath: hw.profile?.hardware.printer.devicePath ?? '',
        printerPaperSize: hw.profile?.hardware.printer.paperSize ?? '80',
        kitchenConnection: hw.profile?.hardware.kitchenPrinter.connection ?? 'disabled',
        kitchenDevicePath: hw.profile?.hardware.kitchenPrinter.devicePath ?? '',
      };
      setLoaded(true);
    }
  }, [settings.receipt, settings.store.logo, hw.profile, loaded]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    const current: Record<string, unknown> = {
      paperWidth,
      showCurrency,
      showTax,
      showTableNumber,
      taxRoundingMode,
      footer,
      showReceiptCode,
      showDateTime,
      showStaffName,
      showFooter,
      taxRatePercent,
      businessLogo,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      printerConnection,
      printerDevicePath,
      printerPaperSize,
      kitchenConnection,
      kitchenDevicePath,
    };
    return Object.keys(current).some((k) => current[k] !== originalsRef.current[k]);
  }, [
    dirtyVersion,
    paperWidth,
    showCurrency,
    showTax,
    showTableNumber,
    taxRoundingMode,
    footer,
    showReceiptCode,
    showDateTime,
    showStaffName,
    showFooter,
    taxRatePercent,
    businessLogo,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    printerConnection,
    printerDevicePath,
    printerPaperSize,
    kitchenConnection,
    kitchenDevicePath,
  ]);

  const handlePrinterConnectionChange = (v: string) => {
    const conn = v as 'auto' | 'network' | 'usb' | 'serial' | 'disabled';
    setPrinterConnection(conn);
    hw.updatePrinter({ connection: conn });
  };

  const handlePrinterDevicePathChange = (v: string) => {
    setPrinterDevicePath(v);
    hw.updatePrinter({ devicePath: v });
  };

  const handlePrinterPaperSizeChange = (v: string) => {
    const ps = v as '80' | '58';
    setPrinterPaperSize(ps);
    hw.updatePrinter({ paperSize: ps });
  };

  const handleKitchenConnectionChange = (v: string) => {
    const conn = v as 'disabled' | 'network' | 'usb' | 'serial' | 'auto';
    setKitchenConnection(conn);
    hw.updateKitchenPrinter({ connection: conn });
  };

  const handleKitchenDevicePathChange = (v: string) => {
    setKitchenDevicePath(v);
    hw.updateKitchenPrinter({ devicePath: v });
  };

  const handleLogoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      addToast({
        message: 'Logo file too large (maximum 2MB)',
        type: 'error',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBusinessLogo(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // ── Test Print ──────────────────────────────────────────────
  const handleTestPrint = useCallback(async () => {
    if (!sessionToken) return;
    setTestingPrint(true);
    try {
      const currency = settings.store.currency || 'IDR';
      await printSalesReceipt(sessionToken, {
        receiptNumber: '01-01-260929-01-000042',
        date: new Date().toLocaleDateString(),
        subtotal: { minorUnits: 30000, currency },
        ...(showTax ? { tax: { minorUnits: Math.round(30000 * (taxRatePercent / 100)), currency } } : {}),
        total: { minorUnits: showTax ? Math.round(30000 * (1 + taxRatePercent / 100)) : 30000, currency },
        items: [
          {
            name: 'Nasi Goreng Spesial',
            quantity: 1,
            unitPrice: { minorUnits: 25000, currency },
            totalPrice: { minorUnits: 25000, currency },
          },
          {
            name: 'Es Teh Manis',
            quantity: 1,
            unitPrice: { minorUnits: 5000, currency },
            totalPrice: { minorUnits: 5000, currency },
          },
        ],
        payments: [
          {
            method: 'cash',
            amount: { minorUnits: 35000, currency },
            change: null,
          },
        ],
        ...(showTableNumber ? { tableNumber: 'Table 1' } : {}),
      });
      addToast({
        message: l10n.getString('restaurant-test-print-success'),
        type: 'success',
      });
    } catch {
      addToast({
        message: l10n.getString('restaurant-test-print-failed'),
        type: 'error',
      });
    } finally {
      setTestingPrint(false);
    }
  }, [sessionToken, settings.store.currency, showTax, taxRatePercent, showTableNumber, showFooter, footer, l10n, addToast]);

  // ── Save handler ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // 1. Save workspace receipt format settings
      tasks.push(
        setReceiptSettingsScoped(sessionToken ?? '', {
          showCurrency,
          decimalSeparator: settings.receipt.decimalSeparator,
          showTax,
          footer: showFooter ? footer : '',
          paperWidth,
          showTableNumber,
          marginTop,
          marginBottom,
          marginLeft,
          marginRight,
          taxRoundingMode,
        }),
      );

      // 2. Save device hardware profile
      if (effectiveTerminalId && hw.profile) {
        tasks.push(hw.save());
      }

      // 3. Save extended toggles & preferences
      if (sessionToken) {
        tasks.push(
          setUserPreferencesScoped(sessionToken, [
            { key: 'resto_rcpt_show_code', value: String(showReceiptCode) },
            { key: 'resto_rcpt_show_dt', value: String(showDateTime) },
            { key: 'resto_rcpt_show_staff', value: String(showStaffName) },
            { key: 'resto_rcpt_show_footer', value: String(showFooter) },
            { key: 'resto_rcpt_tax_rate', value: String(taxRatePercent) },
            { key: 'resto_rcpt_logo', value: businessLogo },
          ]),
        );
      }

      // Cache to localStorage for instantaneous client load
      try {
        localStorage.setItem('resto_rcpt_show_code', String(showReceiptCode));
        localStorage.setItem('resto_rcpt_show_dt', String(showDateTime));
        localStorage.setItem('resto_rcpt_show_staff', String(showStaffName));
        localStorage.setItem('resto_rcpt_show_footer', String(showFooter));
        localStorage.setItem('resto_rcpt_tax_rate', String(taxRatePercent));
        localStorage.setItem('resto_rcpt_logo', businessLogo);
      } catch {
        // Safe to ignore
      }

      await Promise.all(tasks);

      originalsRef.current = {
        paperWidth,
        showCurrency,
        showTax,
        showTableNumber,
        taxRoundingMode,
        footer,
        showReceiptCode,
        showDateTime,
        showStaffName,
        showFooter,
        taxRatePercent,
        businessLogo,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        printerConnection,
        printerDevicePath,
        printerPaperSize,
        kitchenConnection,
        kitchenDevicePath,
      };
      setDirtyVersion((v) => v + 1);

      markSettingsUpdated?.([
        'receipt.paperWidth',
        'receipt.showCurrency',
        'receipt.showTax',
        'receipt.showTableNumber',
        'receipt.taxRoundingMode',
        'receipt.footer',
        'receipt.marginTop',
        'receipt.marginBottom',
        'receipt.marginLeft',
        'receipt.marginRight',
      ]);

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
    effectiveTerminalId,
    hw,
    showCurrency,
    settings.receipt.decimalSeparator,
    showTax,
    showFooter,
    footer,
    paperWidth,
    showTableNumber,
    showReceiptCode,
    showDateTime,
    showStaffName,
    taxRatePercent,
    businessLogo,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    taxRoundingMode,
    printerConnection,
    printerDevicePath,
    printerPaperSize,
    kitchenConnection,
    kitchenDevicePath,
    markSettingsUpdated,
    addToast,
    l10n,
    onSaved,
  ]);

  // ── Accurate Calculations for Thermal Preview ───────────────
  const rollWidthMm = paperWidth === 'narrow' ? 58 : 80;
  const printableAreaMm = Math.max(15, rollWidthMm - (marginLeft + marginRight));
  const approxCols = paperWidth === 'narrow'
    ? Math.max(16, Math.round((printableAreaMm / 52) * 32))
    : Math.max(20, Math.round((printableAreaMm / 74) * 44));

  const formatPrice = (amount: number) => {
    const formattedNum = amount.toLocaleString('id-ID');
    if (!showCurrency) return formattedNum;
    const cur = settings.store.currency || 'IDR';
    return `${cur === 'IDR' ? 'Rp ' : `${cur} `}${formattedNum}`;
  };

  const sampleSubtotal = 93000;
  const rawTax = sampleSubtotal * (taxRatePercent / 100);
  const sampleTax = taxRoundingMode === 'truncate' ? Math.floor(rawTax) : Math.round(rawTax);
  const sampleTotal = showTax ? sampleSubtotal + sampleTax : sampleSubtotal;
  const sampleCash = 100000;
  const sampleChange = Math.max(0, sampleCash - sampleTotal);

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header">
        <h1 className="restaurant-settings-title">
          <Localized id="restaurant-receipts-title">Receipt &amp; Printer Settings</Localized>
        </h1>
        <p className="restaurant-settings-subtitle">
          <Localized id="restaurant-receipts-subtitle">
            Configure receipt layout and device printer connections
          </Localized>
        </p>
      </div>

      <div className="restaurant-settings-layout">
        {/* ── Left Column: Live Accurate Thermal Receipt Preview ── */}
        <aside
          className="restaurant-preview-column"
          aria-label={l10n.getString('restaurant-preview-title') || 'Print Preview'}
        >
          <div className="restaurant-preview-card">
            <div className="restaurant-preview-header-bar">
              <span className="restaurant-preview-title">
                <Localized id="restaurant-preview-title">Print Preview</Localized>
              </span>
              <span className="restaurant-preview-badge">
                <Localized id="restaurant-preview-live-badge">Live Preview</Localized>
              </span>
            </div>

            {/* Thermal Paper Container */}
            <div className="resto-receipt-paper-wrapper">
              <div
                className={`resto-receipt-paper resto-receipt-paper--${paperWidth === 'narrow' ? '58mm' : '80mm'}`}
                style={{
                  paddingTop: `${marginTop}mm`,
                  paddingBottom: `${marginBottom}mm`,
                  paddingLeft: `${marginLeft}mm`,
                  paddingRight: `${marginRight}mm`,
                }}
              >
                <div className="resto-receipt-printable-area">
                  {/* Business Logo */}
                  {businessLogo && (
                    <div className="resto-receipt-logo-wrap">
                      <img src={businessLogo} alt="Business logo" className="resto-receipt-logo" />
                    </div>
                  )}

                  {/* Store Header */}
                  <div className="resto-receipt-center">
                    <div className="resto-receipt-store-title">
                      {settings.store.name ? settings.store.name.toUpperCase() : 'KASIR.MU RESTAURANT'}
                    </div>
                    {settings.store.address && (
                      <div style={{ fontSize: '9px', color: '#4b5563', marginBottom: '2px' }}>
                        {settings.store.address}
                      </div>
                    )}
                    {/* Timestamp & Receipt Code */}
                    {(showDateTime || showReceiptCode) && (
                      <div className="resto-receipt-meta">
                        {showDateTime ? <span>29/09/2026 21:15</span> : <span />}
                        {showReceiptCode ? <span>01-01-260929-01-000042</span> : <span />}
                      </div>
                    )}
                    {/* Staff Name & Table Number */}
                    {(showStaffName || showTableNumber) && (
                      <div className="resto-receipt-meta" style={{ marginTop: '2px' }}>
                        {showStaffName ? <span>Staff: {staffDisplayName}</span> : <span />}
                        {showTableNumber ? <span className="resto-receipt-table-pill">TABLE 4</span> : <span />}
                      </div>
                    )}
                  </div>

                  <div className="resto-receipt-divider" />

                  {/* Line Items */}
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">1x Nasi Goreng Spesial</span>
                    <span className="resto-receipt-item-price">{formatPrice(35000)}</span>
                  </div>
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">2x Es Teh Manis</span>
                    <span className="resto-receipt-item-price">{formatPrice(16000)}</span>
                  </div>
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">1x Ayam Bakar Madu</span>
                    <span className="resto-receipt-item-price">{formatPrice(42000)}</span>
                  </div>

                  <div className="resto-receipt-divider" />

                  {/* Totals */}
                  <div className="resto-receipt-totals-block">
                    <div className="resto-receipt-total-row">
                      <span>Subtotal</span>
                      <span>{formatPrice(sampleSubtotal)}</span>
                    </div>
                    {showTax && (
                      <div className="resto-receipt-total-row">
                        <span>PB1 / Tax ({taxRatePercent}%)</span>
                        <span>{formatPrice(sampleTax)}</span>
                      </div>
                    )}
                    <div className="resto-receipt-divider" />
                    <div className="resto-receipt-total-row resto-receipt-grand-total">
                      <span>TOTAL</span>
                      <span>{formatPrice(sampleTotal)}</span>
                    </div>
                    <div className="resto-receipt-total-row" style={{ fontSize: '10px', color: '#4b5563' }}>
                      <span>Cash</span>
                      <span>{formatPrice(sampleCash)}</span>
                    </div>
                    <div className="resto-receipt-total-row" style={{ fontSize: '10px', color: '#4b5563' }}>
                      <span>Change</span>
                      <span>{formatPrice(sampleChange)}</span>
                    </div>
                  </div>

                  {/* Footer note */}
                  {showFooter && (
                    <>
                      <div className="resto-receipt-divider" />
                      <div className="resto-receipt-footer-text">
                        {footer.trim()
                          ? footer
                          : l10n.getString('restaurant-footer-placeholder') || 'Terima kasih atas kunjungan Anda!'}
                      </div>
                    </>
                  )}

                  {/* Free Tier Watermark */}
                  {isFreeTier && (
                    <div className="resto-receipt-watermark">
                      <span>kasir.mu</span>
                    </div>
                  )}
                </div>

                <div className="resto-receipt-cut-edge" aria-hidden="true" />
              </div>
            </div>

            {/* Printable HUD Status */}
            <div className="resto-preview-hud" aria-live="polite">
              <span className="resto-preview-hud-tag">
                {paperWidth === 'narrow' ? '58 mm Roll' : '80 mm Roll'}
              </span>
              <span>
                Area: {printableAreaMm} mm (~{approxCols} cols)
              </span>
            </div>

            {/* Test Print Button under preview */}
            <Button
              variant="secondary"
              size="md"
              loading={testingPrint}
              onClick={handleTestPrint}
              style={{ width: '100%' }}
            >
              <Localized id="restaurant-test-print">Test Print Receipt</Localized>
            </Button>
          </div>
        </aside>

        {/* ── Right Column: Configuration Controls ──────────── */}
        <main className="restaurant-settings-column">
          {/* ── Card 1: Receipt Format & Margins ───────────────── */}
          <Card
            shadow="sm"
            header={
              <div className="restaurant-settings-card-header">
                <div>
                  <h2 className="settings-section-title">
                    <Localized id="restaurant-receipt-format-heading">Receipt Format</Localized>
                  </h2>
                  <p>
                    <Localized id="settings-rcptfmt-source-workspace">Workspace setting</Localized>
                  </p>
                </div>
              </div>
            }
          >
            {/* Business Logo Section */}
            <div className="resto-logo-section">
              <div className="resto-toggle-title">
                <Localized id="restaurant-logo-heading">Business Logo</Localized>
              </div>
              <div className="resto-toggle-desc">
                <Localized id="restaurant-logo-desc">
                  Upload a square PNG or SVG logo for the receipt header
                </Localized>
              </div>
              <div className="resto-logo-row">
                <div className="resto-logo-thumb-box">
                  {businessLogo ? (
                    <img src={businessLogo} alt="Logo preview" className="resto-logo-thumb" />
                  ) : (
                    <span style={{ fontSize: '10px', color: 'var(--color-fg-muted)' }}>No logo</span>
                  )}
                </div>
                <div className="resto-logo-actions">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".svg,.png,.jpg,.jpeg,.webp"
                    style={{ display: 'none' }}
                    onChange={handleLogoFileChange}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Localized id="restaurant-logo-upload-btn">Choose Logo</Localized>
                    </Button>
                    {businessLogo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBusinessLogo('')}
                      >
                        <Localized id="restaurant-logo-remove-btn">Remove Logo</Localized>
                      </Button>
                    )}
                  </div>
                  <input
                    type="text"
                    className="resto-margin-input"
                    style={{ marginTop: '4px', fontSize: '11px' }}
                    placeholder={l10n.getString('restaurant-logo-url-placeholder') || 'Or paste Image URL / SVG code'}
                    value={businessLogo.startsWith('data:') ? 'Custom uploaded image' : businessLogo}
                    onChange={(e) => {
                      if (!e.target.value.startsWith('Custom uploaded')) {
                        setBusinessLogo(e.target.value);
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Paper Width Segmented Control */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>
                <Localized id="workspace-pos-paper-width">Paper Width</Localized>
              </div>
              <div className="resto-segmented-group" role="group" aria-label={l10n.getString('workspace-pos-paper-width') || 'Paper Width'}>
                <button
                  type="button"
                  className={`resto-segmented-btn ${paperWidth === 'standard' ? 'resto-segmented-btn--active' : ''}`}
                  onClick={() => setPaperWidth('standard')}
                >
                  <Localized id="restaurant-preview-paper-width-standard">80 mm (Standard)</Localized>
                </button>
                <button
                  type="button"
                  className={`resto-segmented-btn ${paperWidth === 'narrow' ? 'resto-segmented-btn--active' : ''}`}
                  onClick={() => setPaperWidth('narrow')}
                >
                  <Localized id="restaurant-preview-paper-width-narrow">58 mm (Compact)</Localized>
                </button>
              </div>
            </div>

            {/* Paper Margins (0-30mm top/bottom, 0-15mm left/right) */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div className="resto-toggle-title">
                <Localized id="restaurant-margins-heading">Paper Margins (mm)</Localized>
              </div>
              <div className="resto-margins-grid">
                {/* Margin Top (0-30 mm) */}
                <div className="resto-margin-card">
                  <div className="resto-margin-header">
                    <label htmlFor="resto-margin-top" className="resto-margin-label">
                      <Localized id="restaurant-margin-top">Top</Localized>
                    </label>
                    <span className="resto-margin-range">0 – 30 mm</span>
                  </div>
                  <div className="resto-margin-input-wrap">
                    <input
                      id="resto-margin-top"
                      type="number"
                      className="resto-margin-input"
                      min={0}
                      max={30}
                      value={marginTop}
                      onChange={(e) => setMarginTop(clamp(Number(e.target.value), 0, 30))}
                    />
                    <span className="resto-margin-unit">mm</span>
                  </div>
                </div>

                {/* Margin Bottom (0-30 mm) */}
                <div className="resto-margin-card">
                  <div className="resto-margin-header">
                    <label htmlFor="resto-margin-bottom" className="resto-margin-label">
                      <Localized id="restaurant-margin-bottom">Bottom</Localized>
                    </label>
                    <span className="resto-margin-range">0 – 30 mm</span>
                  </div>
                  <div className="resto-margin-input-wrap">
                    <input
                      id="resto-margin-bottom"
                      type="number"
                      className="resto-margin-input"
                      min={0}
                      max={30}
                      value={marginBottom}
                      onChange={(e) => setMarginBottom(clamp(Number(e.target.value), 0, 30))}
                    />
                    <span className="resto-margin-unit">mm</span>
                  </div>
                </div>

                {/* Margin Left (0-15 mm) */}
                <div className="resto-margin-card">
                  <div className="resto-margin-header">
                    <label htmlFor="resto-margin-left" className="resto-margin-label">
                      <Localized id="restaurant-margin-left">Left</Localized>
                    </label>
                    <span className="resto-margin-range">0 – 15 mm</span>
                  </div>
                  <div className="resto-margin-input-wrap">
                    <input
                      id="resto-margin-left"
                      type="number"
                      className="resto-margin-input"
                      min={0}
                      max={15}
                      value={marginLeft}
                      onChange={(e) => setMarginLeft(clamp(Number(e.target.value), 0, 15))}
                    />
                    <span className="resto-margin-unit">mm</span>
                  </div>
                </div>

                {/* Margin Right (0-15 mm) */}
                <div className="resto-margin-card">
                  <div className="resto-margin-header">
                    <label htmlFor="resto-margin-right" className="resto-margin-label">
                      <Localized id="restaurant-margin-right">Right</Localized>
                    </label>
                    <span className="resto-margin-range">0 – 15 mm</span>
                  </div>
                  <div className="resto-margin-input-wrap">
                    <input
                      id="resto-margin-right"
                      type="number"
                      className="resto-margin-input"
                      min={0}
                      max={15}
                      value={marginRight}
                      onChange={(e) => setMarginRight(clamp(Number(e.target.value), 0, 15))}
                    />
                    <span className="resto-margin-unit">mm</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Toggle: Receipt Code */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="restaurant-toggle-receipt-code">Show Receipt Code</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-toggle-receipt-code-desc">
                    Print unique hierarchical receipt number
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showReceiptCode}
                aria-label={l10n.getString('restaurant-toggle-receipt-code') || 'Show Receipt Code'}
                className="resto-switch-btn"
                onClick={() => setShowReceiptCode(!showReceiptCode)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {/* Toggle: Date & Time */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="restaurant-toggle-datetime">Show Date &amp; Time</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-toggle-datetime-desc">
                    Print transaction date and timestamp on header
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showDateTime}
                aria-label={l10n.getString('restaurant-toggle-datetime') || 'Show Date and Time'}
                className="resto-switch-btn"
                onClick={() => setShowDateTime(!showDateTime)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {/* Toggle: Staff Name */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="restaurant-toggle-staff">Show Staff Name</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-toggle-staff-desc">
                    Print serving staff or cashier name
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showStaffName}
                aria-label={l10n.getString('restaurant-toggle-staff') || 'Show Staff Name'}
                className="resto-switch-btn"
                onClick={() => setShowStaffName(!showStaffName)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {/* Toggle: Table Number */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="workspace-pos-show-table">Show Table Number</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-show-table-desc">
                    Print assigned table on receipt header
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showTableNumber}
                aria-label={l10n.getString('workspace-pos-show-table') || 'Show Table Number'}
                className="resto-switch-btn"
                onClick={() => setShowTableNumber(!showTableNumber)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {/* Toggle: Currency Symbol */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="workspace-pos-show-currency">Show Currency</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-show-currency-desc">
                    Prefix prices with currency code or symbol
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showCurrency}
                aria-label={l10n.getString('workspace-pos-show-currency') || 'Show Currency'}
                className="resto-switch-btn"
                onClick={() => setShowCurrency(!showCurrency)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {/* Toggle: Tax & Tax Rate Input */}
            <div className="resto-toggle-row">
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="workspace-pos-show-tax">Show Tax</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-show-tax-desc">
                    Print tax rate and amount breakdown
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showTax}
                aria-label={l10n.getString('workspace-pos-show-tax') || 'Show Tax'}
                className="resto-switch-btn"
                onClick={() => setShowTax(!showTax)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {showTax && (
              <div className="resto-tax-input-wrap">
                <label htmlFor="resto-tax-rate" className="resto-toggle-title" style={{ fontSize: 'var(--text-xs)' }}>
                  <Localized id="restaurant-tax-rate-label">Tax Rate (%)</Localized>
                </label>
                <input
                  id="resto-tax-rate"
                  type="number"
                  className="resto-margin-input"
                  style={{ maxWidth: '80px' }}
                  min={0}
                  max={100}
                  step={0.5}
                  value={taxRatePercent}
                  onChange={(e) => setTaxRatePercent(clamp(Number(e.target.value), 0, 100))}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>
                  <Localized id="restaurant-tax-rate-hint">
                    Standard restaurant PB1 is 10%, VAT/PPN is 11–12%
                  </Localized>
                </span>
              </div>
            )}

            {/* Tax Rounding */}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <label htmlFor="resto-rcpt-tax-rounding" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                <Localized id="workspace-pos-tax-rounding">Tax Rounding</Localized>
              </label>
              <SettingsSelect
                id="resto-rcpt-tax-rounding"
                value={taxRoundingMode}
                onChange={(v) => setTaxRoundingMode(v as 'half_up' | 'truncate')}
                options={[
                  { value: 'half_up', label: 'Half Up (Standard)' },
                  { value: 'truncate', label: 'Truncate (Down)' },
                ]}
              />
            </div>

            {/* Toggle: Footer Note */}
            <div className="resto-toggle-row" style={{ marginTop: 'var(--space-3)' }}>
              <div className="resto-toggle-info">
                <span className="resto-toggle-title">
                  <Localized id="restaurant-toggle-footer">Show Footer Note</Localized>
                </span>
                <span className="resto-toggle-desc">
                  <Localized id="restaurant-toggle-footer-desc">
                    Print thank-you or promotional message at bottom
                  </Localized>
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showFooter}
                aria-label={l10n.getString('restaurant-toggle-footer') || 'Show Footer Note'}
                className="resto-switch-btn"
                onClick={() => setShowFooter(!showFooter)}
              >
                <span className="resto-switch-handle" />
              </button>
            </div>

            {showFooter && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label htmlFor="resto-rcpt-footer" className="resto-toggle-title" style={{ fontSize: 'var(--text-xs)' }}>
                    <Localized id="workspace-pos-footer">Receipt Footer Text</Localized>
                  </label>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>
                    {footer.length}/500
                  </span>
                </div>
                <textarea
                  id="resto-rcpt-footer"
                  className="resto-textarea"
                  rows={3}
                  maxLength={500}
                  placeholder={l10n.getString('restaurant-footer-placeholder') || 'Thank you for dining with us!'}
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                />
              </div>
            )}

            {/* Free Tier Watermark Notice */}
            <div className={`resto-tier-notice ${isFreeTier ? 'resto-tier-notice--free' : 'resto-tier-notice--paid'}`}>
              {isFreeTier ? (
                <Localized id="restaurant-free-tier-watermark-notice">
                  Free Plan: "kasir.mu" is always printed after footer
                </Localized>
              ) : (
                <Localized id="restaurant-paid-tier-watermark-notice">
                  Paid Plan: Watermark removed
                </Localized>
              )}
            </div>
          </Card>

          {/* ── Card 2: Hardware Printers ──────────────────────── */}
          <Card
            shadow="sm"
            header={
              <div className="restaurant-settings-card-header">
                <div>
                  <h2 className="settings-section-title">
                    <Localized id="restaurant-receipt-printers-heading">Printers</Localized>
                  </h2>
                  <p>
                    <Localized id="restaurant-receipt-source-device">Device profile (this terminal)</Localized>
                  </p>
                </div>
              </div>
            }
          >
            {/* Primary Receipt Printer */}
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label htmlFor="resto-hw-printer-conn" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                <Localized id="restaurant-printer-connection">Connection</Localized>
              </label>
              <SettingsSelect
                id="resto-hw-printer-conn"
                value={printerConnection}
                onChange={handlePrinterConnectionChange}
                options={[
                  { value: 'auto', label: 'Auto Detect' },
                  { value: 'network', label: 'Network / Ethernet' },
                  { value: 'usb', label: 'USB' },
                  { value: 'serial', label: 'Serial / COM' },
                  { value: 'disabled', label: 'Disabled' },
                ]}
              />
            </div>

            {(printerConnection === 'network' || printerConnection === 'serial' || printerConnection === 'usb') && (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="resto-hw-printer-path" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                  {printerConnection === 'network' ? 'Printer IP / Host' : 'Device Port / Path'}
                </label>
                <input
                  id="resto-hw-printer-path"
                  type="text"
                  className="resto-margin-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={printerConnection === 'network' ? '192.168.1.100:9100' : 'COM3 or /dev/ttyUSB0'}
                  value={printerDevicePath}
                  onChange={(e) => handlePrinterDevicePathChange(e.target.value)}
                />
              </div>
            )}

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="resto-hw-printer-paper" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                <Localized id="restaurant-printer-papersize">Paper Size</Localized>
              </label>
              <SettingsSelect
                id="resto-hw-printer-paper"
                value={printerPaperSize}
                onChange={handlePrinterPaperSizeChange}
                options={[
                  { value: '80', label: '80 mm' },
                  { value: '58', label: '58 mm' },
                ]}
              />
            </div>

            {/* Kitchen Printer */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="resto-hw-kitchen-conn" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                  Kitchen Printer Connection
                </label>
                <SettingsSelect
                  id="resto-hw-kitchen-conn"
                  value={kitchenConnection}
                  onChange={handleKitchenConnectionChange}
                  options={[
                    { value: 'disabled', label: 'Disabled' },
                    { value: 'network', label: 'Network / Ethernet' },
                    { value: 'usb', label: 'USB' },
                    { value: 'serial', label: 'Serial / COM' },
                  ]}
                />
              </div>

              {kitchenConnection !== 'disabled' && (
                <div>
                  <label htmlFor="resto-hw-kitchen-path" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                    Kitchen Printer IP / Device Path
                  </label>
                  <input
                    id="resto-hw-kitchen-path"
                    type="text"
                    className="resto-margin-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    placeholder="192.168.1.101:9100"
                    value={kitchenDevicePath}
                    onChange={(e) => handleKitchenDevicePathChange(e.target.value)}
                  />
                </div>
              )}
            </div>
          </Card>

          {/* Action Bar */}
          <div className="restaurant-settings-actions">
            <span style={{ fontSize: 'var(--text-xs)', color: dirty ? 'var(--color-warning)' : 'var(--color-fg-muted)' }}>
              {dirty ? (
                <Localized id="restaurant-unsaved-changes">Unsaved changes</Localized>
              ) : (
                <Localized id="restaurant-all-saved">All changes saved</Localized>
              )}
            </span>
            <Button
              variant="primary"
              size="lg"
              loading={saving}
              disabled={!dirty || saving}
              onClick={handleSave}
            >
              <Localized id="save">Save Changes</Localized>
            </Button>
          </div>
        </main>
      </div>
    </div>
  );
}
