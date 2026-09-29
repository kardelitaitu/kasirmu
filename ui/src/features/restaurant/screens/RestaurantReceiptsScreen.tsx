import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { setReceiptSettingsScoped } from '@/api/settings';
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
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    taxRoundingMode: 'half_up',
  },
  store: { name: '', address: '', taxId: '', currency: 'IDR', branch: '' },
};

export interface RestaurantReceiptsScreenProps {
  terminalId?: string;
  onSaved?: () => void;
  onBack?: () => void;
}

export function RestaurantReceiptsScreen({
  terminalId: propTerminalId,
  onSaved,
}: RestaurantReceiptsScreenProps) {
  const settingsCtx = useOptionalSettings();
  const settings = settingsCtx?.settings ?? FALLBACK_SETTINGS;
  const markSettingsUpdated = settingsCtx?.markSettingsUpdated;
  const { sessionToken, terminalId: contextTerminalId } = useWorkspace();
  const effectiveTerminalId = propTerminalId || contextTerminalId || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(effectiveTerminalId, settings.store.currency);

  // ── Receipt format draft state ──────────────────────────────
  const [paperWidth, setPaperWidth] = useState<'standard' | 'narrow'>('standard');
  const [showCurrency, setShowCurrency] = useState(false);
  const [showTax, setShowTax] = useState(true);
  const [showTableNumber, setShowTableNumber] = useState(false);
  const [taxRoundingMode, setTaxRoundingMode] = useState<'half_up' | 'truncate'>('half_up');
  const [footer, setFooter] = useState('');

  // ── Printer device draft state ──────────────────────────────
  const [printerConnection, setPrinterConnection] = useState<'auto' | 'network' | 'usb' | 'serial' | 'disabled'>('auto');
  const [printerDevicePath, setPrinterDevicePath] = useState('');
  const [printerPaperSize, setPrinterPaperSize] = useState<'80' | '58'>('80');
  const [kitchenConnection, setKitchenConnection] = useState<'disabled' | 'network' | 'usb' | 'serial' | 'auto'>('disabled');
  const [kitchenDevicePath, setKitchenDevicePath] = useState('');

  const [saving, setSaving] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  // `dirtyVersion` is a deliberate re-render trigger, never read as a value:
  // `originalsRef.current` is replaced on save, and `dirty` only recomputes when
  // a draft field changes, so without bumping this the Save button would stay
  // disabled after a successful save. Named with a leading underscore so the
  // unused value reads as intentional rather than a forgotten read.
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // Track originals for dirty state
  const originalsRef = useRef<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const receiptInitializedRef = useRef(false);
  const hwInitializedRef = useRef(false);

  useEffect(() => {
    if (receiptInitializedRef.current) return;
    setPaperWidth(settings.receipt.paperWidth === 'narrow' ? 'narrow' : 'standard');
    setShowCurrency(settings.receipt.showCurrency);
    setShowTax(settings.receipt.showTax);
    setShowTableNumber(settings.receipt.showTableNumber);
    setTaxRoundingMode((settings.receipt.taxRoundingMode as 'half_up' | 'truncate') ?? 'half_up');
    setFooter(settings.receipt.footer ?? '');
    receiptInitializedRef.current = true;
  }, [settings.receipt]);

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

  useEffect(() => {
    if (!loaded) {
      originalsRef.current = {
        paperWidth: settings.receipt.paperWidth,
        showCurrency: settings.receipt.showCurrency,
        showTax: settings.receipt.showTax,
        showTableNumber: settings.receipt.showTableNumber,
        taxRoundingMode: settings.receipt.taxRoundingMode ?? 'half_up',
        footer: settings.receipt.footer,
        printerConnection: hw.profile?.hardware.printer.connection ?? 'auto',
        printerDevicePath: hw.profile?.hardware.printer.devicePath ?? '',
        printerPaperSize: hw.profile?.hardware.printer.paperSize ?? '80',
        kitchenConnection: hw.profile?.hardware.kitchenPrinter.connection ?? 'disabled',
        kitchenDevicePath: hw.profile?.hardware.kitchenPrinter.devicePath ?? '',
      };
      setLoaded(true);
    }
  }, [settings.receipt, hw.profile, loaded]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    const current: Record<string, unknown> = {
      paperWidth,
      showCurrency,
      showTax,
      showTableNumber,
      taxRoundingMode,
      footer,
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
    const size = v as '58' | '80';
    setPrinterPaperSize(size);
    hw.updatePrinter({ paperSize: size });
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

  // ── Test print ──────────────────────────────────────────────
  const handleTestPrint = useCallback(async () => {
    if (!sessionToken) return;
    setTestingPrint(true);
    try {
      const currency = settings.store.currency || 'IDR';
      await printSalesReceipt(sessionToken, {
        date: new Date().toISOString(),
        receiptNumber: 'TEST-001',
        subtotal: { minorUnits: 35000, currency },
        total: { minorUnits: 35000, currency },
        items: [
          {
            name: 'Test Item (Ayam Bakar)',
            quantity: 1,
            unitPrice: { minorUnits: 30000, currency },
            totalPrice: { minorUnits: 30000, currency },
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
        tableNumber: 'Table 1',
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
  }, [sessionToken, settings.store.currency, l10n, addToast]);

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
          footer,
          paperWidth,
          showTableNumber,
          marginTop: settings.receipt.marginTop,
          marginBottom: settings.receipt.marginBottom,
          marginLeft: settings.receipt.marginLeft,
          marginRight: settings.receipt.marginRight,
          taxRoundingMode,
        }),
      );

      // 2. Save device hardware profile
      if (effectiveTerminalId && hw.profile) {
        tasks.push(hw.save());
      }

      await Promise.all(tasks);

      originalsRef.current = {
        paperWidth,
        showCurrency,
        showTax,
        showTableNumber,
        taxRoundingMode,
        footer,
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
    settings.receipt,
    showTax,
    footer,
    paperWidth,
    showTableNumber,
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

      {/* ── Card 1: Receipt Format (Workspace) ───────────────── */}
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
        <div className="settings-form">
          {/* Paper width */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-paper-width" className="settings-label">
              <Localized id="workspace-pos-paper-width">Paper Width</Localized>
            </label>
            <SettingsSelect
              id="resto-rcpt-paper-width"
              value={paperWidth}
              onChange={(v) => setPaperWidth(v as 'standard' | 'narrow')}
              options={[
                { value: 'standard', label: '80 mm' },
                { value: 'narrow', label: '58 mm' },
              ]}
            />
          </div>

          {/* Show table number */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-table" className="settings-label">
              <Localized id="workspace-pos-show-table">Show Table Number</Localized>
            </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="resto-rcpt-table"
                  type="checkbox"
                  role="switch"
                  checked={showTableNumber}
                  aria-checked={showTableNumber}
                  onChange={(e) => setShowTableNumber(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Show currency */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-currency" className="settings-label">
              <Localized id="workspace-pos-show-currency">Show Currency</Localized>
            </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="resto-rcpt-currency"
                  type="checkbox"
                  role="switch"
                  checked={showCurrency}
                  aria-checked={showCurrency}
                  onChange={(e) => setShowCurrency(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Show tax */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-tax" className="settings-label">
              <Localized id="workspace-pos-show-tax">Show Tax</Localized>
            </label>
            <span className="settings-toggle">
              <span className="sr-only"><Localized id="toggle">Toggle</Localized></span>
              <span className="settings-toggle-switch">
                <input
                  id="resto-rcpt-tax"
                  type="checkbox"
                  role="switch"
                  checked={showTax}
                  aria-checked={showTax}
                  onChange={(e) => setShowTax(e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </span>
          </div>

          {/* Tax rounding */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-tax-rounding" className="settings-label">
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

          {/* Footer text */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-rcpt-footer" className="settings-label">
              <Localized id="workspace-pos-footer">Receipt Footer</Localized>
            </label>
            <textarea
              id="resto-rcpt-footer"
              className="settings-input"
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>
        </div>
      </Card>

      {/* ── Card 2: Receipt & Kitchen Printers (Device) ─────── */}
      <Card
        shadow="sm"
        header={
          <div className="restaurant-settings-card-header">
            <div>
              <h2 className="settings-section-title">
                <Localized id="restaurant-receipt-printers-heading">Printers</Localized>
              </h2>
              <p>
                <Localized id="settings-rcptfmt-source-terminal">Device / Terminal setting</Localized>
              </p>
            </div>
          </div>
        }
      >
        <div className="settings-form">
          {/* Main Receipt Printer */}
          <h3 style={{ margin: '8px 0 4px', fontSize: '0.9rem', color: 'var(--color-fg-secondary)' }}>
            <Localized id="workspace-pos-printer-heading">Receipt Printer</Localized>
          </h3>
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-printer-conn" className="settings-label">
              <Localized id="workspace-pos-printer-connection">Connection</Localized>
            </label>
            <SettingsSelect
              id="resto-printer-conn"
              value={printerConnection}
              onChange={handlePrinterConnectionChange}
              options={[
                { value: 'auto', label: 'Auto Detect' },
                { value: 'network', label: 'Network (LAN / Wi-Fi)' },
                { value: 'usb', label: 'USB' },
                { value: 'serial', label: 'Serial Port' },
              ]}
            />
          </div>

          {printerConnection === 'network' && (
            <div className="settings-field settings-field--horizontal">
              <label htmlFor="resto-printer-ip" className="settings-label">
                <Localized id="workspace-pos-printer-ip">IP Address</Localized>
              </label>
              <input
                id="resto-printer-ip"
                type="text"
                className="settings-input"
                placeholder="192.168.1.100"
                value={printerDevicePath}
                onChange={(e) => handlePrinterDevicePathChange(e.target.value)}
              />
            </div>
          )}

          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-printer-paper-size" className="settings-label">
              <Localized id="workspace-pos-printer-paper-size">Paper Size</Localized>
            </label>
            <SettingsSelect
              id="resto-printer-paper-size"
              value={printerPaperSize}
              onChange={handlePrinterPaperSizeChange}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' },
              ]}
            />
          </div>

          <div style={{ height: '1px', background: 'var(--color-border)', margin: '12px 0' }} />

          {/* Kitchen Printer */}
          <h3 style={{ margin: '8px 0 4px', fontSize: '0.9rem', color: 'var(--color-fg-secondary)' }}>
            <Localized id="workspace-resto-kitchen-printer-heading">Kitchen Printer</Localized>
          </h3>
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="resto-kp-conn" className="settings-label">
              <Localized id="workspace-resto-kp-connection">Connection</Localized>
            </label>
            <SettingsSelect
              id="resto-kp-conn"
              value={kitchenConnection}
              onChange={handleKitchenConnectionChange}
              options={[
                { value: 'disabled', label: 'Disabled' },
                { value: 'network', label: 'Network (LAN / Wi-Fi)' },
                { value: 'usb', label: 'USB' },
                { value: 'serial', label: 'Serial Port' },
              ]}
            />
          </div>

          {kitchenConnection === 'network' && (
            <div className="settings-field settings-field--horizontal">
              <label htmlFor="resto-kp-ip" className="settings-label">
                <Localized id="workspace-resto-kp-ip">Kitchen Printer IP</Localized>
              </label>
              <input
                id="resto-kp-ip"
                type="text"
                className="settings-input"
                placeholder="192.168.1.150"
                value={kitchenDevicePath}
                onChange={(e) => handleKitchenDevicePathChange(e.target.value)}
              />
            </div>
          )}
        </div>
      </Card>

      {/* ── Actions ─────────────────────────────────────────── */}
      <div className="restaurant-settings-actions">
        <Button
          variant="secondary"
          onClick={handleTestPrint}
          disabled={testingPrint}
        >
          <Localized id="restaurant-test-print">Test Print</Localized>
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          <Localized id="save">Save</Localized>
        </Button>
      </div>
    </div>
  );
}

export default RestaurantReceiptsScreen;
