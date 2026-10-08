import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { l10nErrorMessage } from '@/utils/app-error';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { useToast } from '@/components/Toast';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTerminalHardware } from '@/hooks/useTerminalHardware';
import { FEATURES, useFeatures } from '@/hooks/useFeatures';
import { setReceiptSettingsScoped, setUserPreferencesScoped, getUserPreferencesScoped } from '@/api/settings';
import { getReceiptFormatScoped, setReceiptLayoutScoped } from '@/api/receipt-format';
import { getPrimaryLocationScoped } from '@/api/locations';
import { printSalesReceipt } from '@/api/sales';
import { openCashDrawerScoped } from '@/api/hardware';
import SettingsSelect from '@/features/settings/SettingsSelect';
import { tierSatisfies } from '@/utils/tierLevel';
import { asArray } from '@/utils/ipc-payload';
import {
  clamp,
  rollWidthMm as paperRollWidth,
  printableAreaMm as areaMm,
  approxCols as colsFor,
  formatPrice as _formatPrice,
  fontSizeClass,
  computeReceiptPreview,
  TEST_PRINT_CODES,
  formatTestPrintResult,
  classifyTestPrintError,
  type ReceiptFontSize,
  type ReceiptLogoPosition,
  type TestPrintResult,
  type DecimalSeparator,
} from './receiptLogic';
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

export const MAX_HEADER_TITLE_LENGTH = 26;
export const MAX_HEADER_LINE_LENGTH = 49;

export interface RestaurantReceiptsScreenProps {
  terminalId?: string;
  onSaved?: () => void;
  onBack?: () => void;
  tablesEnabled?: boolean;
}

interface ReceiptFormValues {
  paperWidth: 'standard' | 'narrow';
  fontSize: ReceiptFontSize;
  showCurrency: boolean;
  showThousandsSeparator: boolean;
  showDecimals: boolean;
  showTax: boolean;
  showTableNumber: boolean;
  taxRoundingMode: 'half_up' | 'truncate';
  footer: string;
  showReceiptCode: boolean;
  showDateTime: boolean;
  showStaffName: boolean;
  showFooter: boolean;
  showItemNotes: boolean;
  taxRatePercent: number;
  businessLogo: string;
  logoPosition: ReceiptLogoPosition;
  headerTitle: string;
  headerLine1: string;
  headerLine2: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  printerConnection: 'auto' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'disabled';
  printerDevicePath: string;
  printerPaperSize: '80' | '58';
  kitchenConnection: 'disabled' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'auto';
  kitchenDevicePath: string;
}

function normalizeLogoInput(val: string): string {
  const trimmed = val.trim();
  if (trimmed.startsWith('<svg') || (trimmed.startsWith('<?xml') && trimmed.includes('<svg'))) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

export default function RestaurantReceiptsScreen({
  terminalId: propTerminalId,
  onSaved,
  onBack,
  tablesEnabled: propTablesEnabled,
}: RestaurantReceiptsScreenProps) {
  const settingsCtx = useOptionalSettings();
  const settings = settingsCtx?.settings ?? FALLBACK_SETTINGS;
  const markSettingsUpdated = settingsCtx?.markSettingsUpdated;
  const { sessionToken, terminalId: contextTerminalId } = useWorkspace();
  const { caps } = useSubscription();
  const { session } = useAuth();
  const { isEnabled } = useFeatures();
  const effectiveTerminalId = propTerminalId || contextTerminalId || '';
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const hw = useTerminalHardware(effectiveTerminalId, settings.store.currency);

  const tablesEnabled = propTablesEnabled !== undefined ? propTablesEnabled : isEnabled(FEATURES.TABLE_MANAGEMENT);
  const isFreeTier = !caps || caps.tier === 'free';
  const hasKdsFeature = caps
    ? (caps.maxKdsScreens === null || caps.maxKdsScreens > 0 || tierSatisfies(caps.tier, 'pro'))
    : true;
  const staffDisplayName = session?.display_name || 'Budi S.';

  // ── Receipt format draft state ──────────────────────────────
  const [paperWidth, setPaperWidth] = useState<'standard' | 'narrow'>('standard');
  const [fontSize, setFontSize] = useState<ReceiptFontSize>('medium');
  const [showCurrency, setShowCurrency] = useState(false);
  const [showThousandsSeparator, setShowThousandsSeparator] = useState(false);
  const [showDecimals, setShowDecimals] = useState(false);
  const [showTableNumber, setShowTableNumber] = useState(false);
  const [taxRoundingMode, setTaxRoundingMode] = useState<'half_up' | 'truncate'>('half_up');
  const [footer, setFooter] = useState('');

  // ── New Toggles ─────────────────────────────────────────────
  const [showReceiptCode, setShowReceiptCode] = useState(true);
  const [showDateTime, setShowDateTime] = useState(true);
  const [showStaffName, setShowStaffName] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [showItemNotes, setShowItemNotes] = useState(true);
  const [showTax, setShowTax] = useState(true);
  const [taxRatePercent, setTaxRatePercent] = useState(10);
  const [businessLogo, setBusinessLogo] = useState<string>('');
  const [logoPosition, setLogoPosition] = useState<ReceiptLogoPosition>('left');
  const [headerTitle, setHeaderTitle] = useState('');
  const [headerLine1, setHeaderLine1] = useState('');
  const [headerLine2, setHeaderLine2] = useState('');

  // ── Paper margins state (mm) ────────────────────────────────
  const [marginTop, setMarginTop] = useState(5);
  const [marginBottom, setMarginBottom] = useState(8);
  const [marginLeft, setMarginLeft] = useState(3);
  const [marginRight, setMarginRight] = useState(3);

  // ── Printer device draft state ──────────────────────────────
  const [printerConnection, setPrinterConnection] = useState<'auto' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'disabled'>('auto');
  const [printerDevicePath, setPrinterDevicePath] = useState('');
  const [printerPaperSize, setPrinterPaperSize] = useState<'80' | '58'>('80');
  const [kitchenConnection, setKitchenConnection] = useState<'disabled' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'auto'>('disabled');
  const [kitchenDevicePath, setKitchenDevicePath] = useState('');

  // Bluetooth permission and paired device state (Android native bridge)
  const [btPermissionsGranted, setBtPermissionsGranted] = useState<boolean | null>(null);
  const [pairedBtDevices, setPairedBtDevices] = useState<Array<{ name: string; address: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [testingPrint, setTestingPrint] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [testPrintResult, setTestPrintResult] = useState<TestPrintResult | null>(null);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // The workspace (primary-location) scope id used for the scoped
  // receipt_formats layout write, resolved on load. Null until resolved; the
  // scoped write is skipped while it is null so the screen degrades to the
  // legacy path rather than writing to the wrong scope.
  const [receiptWorkspaceId, setReceiptWorkspaceId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync Bluetooth state and bonded devices via native Android bridge
  const refreshBluetoothDevices = useCallback(() => {
    const win = window as unknown as {
      __kasirmuNative?: {
        hasBluetoothPermissions?: () => boolean;
        getPairedBluetoothDevices?: () => string;
      };
    };
    if (win.__kasirmuNative?.hasBluetoothPermissions) {
      const hasPerms = win.__kasirmuNative.hasBluetoothPermissions();
      setBtPermissionsGranted(hasPerms);
      if (hasPerms && win.__kasirmuNative.getPairedBluetoothDevices) {
        try {
          const list = JSON.parse(win.__kasirmuNative.getPairedBluetoothDevices()) as Array<{ name: string; address: string }>;
          setPairedBtDevices(asArray<typeof list[number]>(list));
        } catch {
          setPairedBtDevices([]);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (printerConnection === 'bluetooth' || kitchenConnection === 'bluetooth') {
      refreshBluetoothDevices();
    }
  }, [printerConnection, kitchenConnection, refreshBluetoothDevices]);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<{ granted: boolean }>;
      setBtPermissionsGranted(custom.detail?.granted ?? false);
      if (custom.detail?.granted) {
        refreshBluetoothDevices();
      }
    };
    window.addEventListener('kasirmu:bluetoothPermissionResult', handler);
    return () => window.removeEventListener('kasirmu:bluetoothPermissionResult', handler);
  }, [refreshBluetoothDevices]);

  // Track originals for dirty state
  const originalsRef = useRef<ReceiptFormValues | null>(null);
  const [loaded, setLoaded] = useState(false);
  const receiptInitializedRef = useRef(false);
  const hwInitializedRef = useRef(false);

  // Initialize receipt settings from workspace context and stored preferences
  useEffect(() => {
    if (receiptInitializedRef.current) return;
    if (settingsCtx?.loading) return;

    // 1. Initial base settings from context
    const initialPaperWidth = settings.receipt.paperWidth === 'narrow' ? 'narrow' : 'standard';
    const initialShowCurrency = settings.receipt.showCurrency;
    const initialShowTax = settings.receipt.showTax;
    const initialShowTableNumber = settings.receipt.showTableNumber;
    const initialTaxRoundingMode = ((settings.receipt.taxRoundingMode as 'half_up' | 'truncate') ?? 'half_up');
    const initialFooter = settings.receipt.footer ?? '';
    const initialMarginTop = Math.max(3, settings.receipt.marginTop || 5);
    const initialMarginBottom = Math.max(3, settings.receipt.marginBottom || 8);
    const initialMarginLeft = Math.max(3, settings.receipt.marginLeft || 3);
    const initialMarginRight = Math.max(3, settings.receipt.marginRight || 3);
    let initialBusinessLogo = settings.store.logo ?? '';
    let initialTitle = (settings.store.name ? settings.store.name.toUpperCase() : 'KASIR.MU RESTAURANT').slice(0, MAX_HEADER_TITLE_LENGTH);
    let initialLine1 = (settings.store.address ?? '').slice(0, MAX_HEADER_LINE_LENGTH);
    let initialLine2 = '';
    let initialFontSize: ReceiptFontSize = 'medium';
    let initialShowCode = true;
    let initialShowDt = true;
    let initialShowStaff = true;
    let initialShowFooter = true;
    let initialShowItemNotes = true;
    let initialShowThousandsSep = false;
    let initialShowDecimals = false;
    let initialTaxRate = 10;
    let initialLogoPos: ReceiptLogoPosition = 'left';

    // 2. Overlay extra toggles from local preferences (localStorage)
    try {
      const localTitle = localStorage.getItem('resto_rcpt_header_title');
      if (localTitle !== null) initialTitle = localTitle.slice(0, MAX_HEADER_TITLE_LENGTH);
      const localL1 = localStorage.getItem('resto_rcpt_header_line1');
      if (localL1 !== null) initialLine1 = localL1.slice(0, MAX_HEADER_LINE_LENGTH);
      const localL2 = localStorage.getItem('resto_rcpt_header_line2');
      if (localL2 !== null) initialLine2 = localL2.slice(0, MAX_HEADER_LINE_LENGTH);
      const localFontSize = localStorage.getItem('resto_rcpt_font_size');
      if (localFontSize && ['very_small', 'small', 'medium', 'large'].includes(localFontSize)) {
        initialFontSize = localFontSize as ReceiptFontSize;
      }
      const localCode = localStorage.getItem('resto_rcpt_show_code');
      if (localCode !== null) initialShowCode = localCode === 'true';
      const localDt = localStorage.getItem('resto_rcpt_show_dt');
      if (localDt !== null) initialShowDt = localDt === 'true';
      const localStaff = localStorage.getItem('resto_rcpt_show_staff');
      if (localStaff !== null) initialShowStaff = localStaff === 'true';
      const localFooter = localStorage.getItem('resto_rcpt_show_footer');
      if (localFooter !== null) initialShowFooter = localFooter === 'true';
      const localItemNotes = localStorage.getItem('resto_rcpt_show_item_notes');
      if (localItemNotes !== null) initialShowItemNotes = localItemNotes === 'true';
      const localThousandsSep = localStorage.getItem('resto_rcpt_thousands_sep');
      if (localThousandsSep !== null) initialShowThousandsSep = localThousandsSep === 'true';
      const localShowDecimals = localStorage.getItem('resto_rcpt_show_decimals');
      if (localShowDecimals !== null) initialShowDecimals = localShowDecimals === 'true';
      const localTaxRate = localStorage.getItem('resto_rcpt_tax_rate');
      if (localTaxRate !== null && !isNaN(Number(localTaxRate))) {
        initialTaxRate = clamp(Number(localTaxRate), 0, 100);
      }
      const localLogo = localStorage.getItem('resto_rcpt_logo');
      if (localLogo) initialBusinessLogo = localLogo;
      const localLogoPos = localStorage.getItem('resto_rcpt_logo_pos');
      if (localLogoPos && ['top', 'left', 'right'].includes(localLogoPos)) {
        initialLogoPos = localLogoPos as ReceiptLogoPosition;
      }
    } catch {
      // LocalStorage unavailable, keep defaults
    }

    // Apply initial state
    setPaperWidth(initialPaperWidth);
    setShowCurrency(initialShowCurrency);
    setShowThousandsSeparator(initialShowThousandsSep);
    setShowDecimals(initialShowDecimals);
    setShowTax(initialShowTax);
    setShowTableNumber(initialShowTableNumber);
    setTaxRoundingMode(initialTaxRoundingMode);
    setFooter(initialFooter);
    setMarginTop(initialMarginTop);
    setMarginBottom(initialMarginBottom);
    setMarginLeft(initialMarginLeft);
    setMarginRight(initialMarginRight);
    setBusinessLogo(initialBusinessLogo);
    setHeaderTitle(initialTitle);
    setHeaderLine1(initialLine1);
    setHeaderLine2(initialLine2);
    setFontSize(initialFontSize);
    setShowReceiptCode(initialShowCode);
    setShowDateTime(initialShowDt);
    setShowStaffName(initialShowStaff);
    setShowFooter(initialShowFooter);
    setShowItemNotes(initialShowItemNotes);
    setTaxRatePercent(initialTaxRate);
    setLogoPosition(initialLogoPos);

    // Initial hardware defaults
    const hwP = hw.profile?.hardware.printer;
    const hwKp = hw.profile?.hardware.kitchenPrinter;
    const initialPrinterConn = hwP?.connection ?? 'auto';
    const initialPrinterPath = hwP?.devicePath ?? '';
    const initialPrinterPaper = hwP?.paperSize === '58' ? '58' : '80';
    const initialKitchenConn = hwKp?.connection ?? 'disabled';
    const initialKitchenPath = hwKp?.devicePath ?? '';

    setPrinterConnection(initialPrinterConn);
    setPrinterDevicePath(initialPrinterPath);
    setPrinterPaperSize(initialPrinterPaper);
    setKitchenConnection(initialKitchenConn);
    setKitchenDevicePath(initialKitchenPath);

    // Seed originals with EXACT matching loaded values
    originalsRef.current = {
      paperWidth: initialPaperWidth,
      fontSize: initialFontSize,
      showCurrency: initialShowCurrency,
      showThousandsSeparator: initialShowThousandsSep,
      showDecimals: initialShowDecimals,
      showTax: initialShowTax,
      showTableNumber: initialShowTableNumber,
      taxRoundingMode: initialTaxRoundingMode,
      footer: initialFooter,
      showReceiptCode: initialShowCode,
      showDateTime: initialShowDt,
      showStaffName: initialShowStaff,
      showFooter: initialShowFooter,
      showItemNotes: initialShowItemNotes,
      taxRatePercent: initialTaxRate,
      businessLogo: initialBusinessLogo,
      logoPosition: initialLogoPos,
      headerTitle: initialTitle,
      headerLine1: initialLine1,
      headerLine2: initialLine2,
      marginTop: initialMarginTop,
      marginBottom: initialMarginBottom,
      marginLeft: initialMarginLeft,
      marginRight: initialMarginRight,
      printerConnection: initialPrinterConn,
      printerDevicePath: initialPrinterPath,
      printerPaperSize: initialPrinterPaper,
      kitchenConnection: initialKitchenConn,
      kitchenDevicePath: initialKitchenPath,
    };

    receiptInitializedRef.current = true;
    setLoaded(true);

    // 3. Attempt remote user preferences read
    if (sessionToken) {
      getUserPreferencesScoped(sessionToken)
        .then((prefs) => {
          const p = prefs as Record<string, string | undefined>;
          if (originalsRef.current) {
            if (p['resto_rcpt_header_title'] !== undefined) {
              const v = p['resto_rcpt_header_title'].slice(0, MAX_HEADER_TITLE_LENGTH);
              setHeaderTitle(v);
              originalsRef.current.headerTitle = v;
            }
            if (p['resto_rcpt_header_line1'] !== undefined) {
              const v = p['resto_rcpt_header_line1'].slice(0, MAX_HEADER_LINE_LENGTH);
              setHeaderLine1(v);
              originalsRef.current.headerLine1 = v;
            }
            if (p['resto_rcpt_header_line2'] !== undefined) {
              const v = p['resto_rcpt_header_line2'].slice(0, MAX_HEADER_LINE_LENGTH);
              setHeaderLine2(v);
              originalsRef.current.headerLine2 = v;
            }
            if (p['resto_rcpt_logo_pos'] && ['top', 'left', 'right'].includes(p['resto_rcpt_logo_pos'])) {
              const v = p['resto_rcpt_logo_pos'] as ReceiptLogoPosition;
              setLogoPosition(v);
              originalsRef.current.logoPosition = v;
            }
            if (p['resto_rcpt_font_size'] && ['very_small', 'small', 'medium', 'large'].includes(p['resto_rcpt_font_size'])) {
              const v = p['resto_rcpt_font_size'] as ReceiptFontSize;
              setFontSize(v);
              originalsRef.current.fontSize = v;
            }
            if (p['resto_rcpt_show_code'] !== undefined) {
              const v = p['resto_rcpt_show_code'] === 'true';
              setShowReceiptCode(v);
              originalsRef.current.showReceiptCode = v;
            }
            if (p['resto_rcpt_show_dt'] !== undefined) {
              const v = p['resto_rcpt_show_dt'] === 'true';
              setShowDateTime(v);
              originalsRef.current.showDateTime = v;
            }
            if (p['resto_rcpt_show_staff'] !== undefined) {
              const v = p['resto_rcpt_show_staff'] === 'true';
              setShowStaffName(v);
              originalsRef.current.showStaffName = v;
            }
            if (p['resto_rcpt_show_footer'] !== undefined) {
              const v = p['resto_rcpt_show_footer'] === 'true';
              setShowFooter(v);
              originalsRef.current.showFooter = v;
            }
            if (p['resto_rcpt_show_item_notes'] !== undefined) {
              const v = p['resto_rcpt_show_item_notes'] === 'true';
              setShowItemNotes(v);
              originalsRef.current.showItemNotes = v;
            }
            if (p['resto_rcpt_thousands_sep'] !== undefined) {
              const v = p['resto_rcpt_thousands_sep'] === 'true';
              setShowThousandsSeparator(v);
              originalsRef.current.showThousandsSeparator = v;
            }
            if (p['resto_rcpt_show_decimals'] !== undefined) {
              const v = p['resto_rcpt_show_decimals'] === 'true';
              setShowDecimals(v);
              originalsRef.current.showDecimals = v;
            }
            if (p['resto_rcpt_tax_rate'] !== undefined) {
              const parsed = Number(p['resto_rcpt_tax_rate']);
              if (!isNaN(parsed)) {
                const v = clamp(parsed, 0, 100);
                setTaxRatePercent(v);
                originalsRef.current.taxRatePercent = v;
              }
            }
            if (p['resto_rcpt_logo']) {
              setBusinessLogo(p['resto_rcpt_logo']);
              originalsRef.current.businessLogo = p['resto_rcpt_logo'];
            }
          }
          setDirtyVersion((v) => v + 1);
        })
        .catch(() => {
          // Fall back gracefully
        });
    }
  }, [settings.receipt, settings.store.logo, settings.store.name, settings.store.address, sessionToken, hw.profile, settingsCtx?.loading]);

  // Overlay the SCOPED receipt format (the same layer the Settings → Business
  // Defaults card owns) on top of the legacy base above, and remember the
  // workspace id so a save writes back to the scope it read from.
  //
  // Why this exists: the legacy `receipt.*` keys this screen historically
  // wrote are a *fallback* for the scoped `receipt_formats` rows. When a
  // manager saved the Business Defaults card, the scoped rows took effect on
  // the printed receipt while this screen kept displaying (and later
  // re-writing) the shadowed legacy values — a silent conflict. Reading the
  // effective format here means the screen shows what actually prints, and
  // the save below writes the same scope, so the two surfaces converge.
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    (async () => {
      try {
        const primary = await getPrimaryLocationScoped(sessionToken);
        if (cancelled) return;
        const workspaceId = primary?.id ?? null;
        setReceiptWorkspaceId(workspaceId);
        const eff = await getReceiptFormatScoped(sessionToken, effectiveTerminalId || null, workspaceId);
        if (cancelled) return;
        const l = eff.layout;
        if (l.paperWidthMm !== null && l.paperWidthMm !== undefined) {
          const pw = l.paperWidthMm <= 58 ? 'narrow' : 'standard';
          setPaperWidth((cur) => {
            if (originalsRef.current && cur === originalsRef.current.paperWidth) {
              originalsRef.current.paperWidth = pw;
              return pw;
            }
            return cur;
          });
        }
        if (l.marginTopMm !== null && l.marginTopMm !== undefined) {
          const v = Math.max(3, l.marginTopMm);
          setMarginTop((cur) => {
            if (originalsRef.current && cur === originalsRef.current.marginTop) {
              originalsRef.current.marginTop = v;
              return v;
            }
            return cur;
          });
        }
        if (l.marginBottomMm !== null && l.marginBottomMm !== undefined) {
          const v = Math.max(3, l.marginBottomMm);
          setMarginBottom((cur) => {
            if (originalsRef.current && cur === originalsRef.current.marginBottom) {
              originalsRef.current.marginBottom = v;
              return v;
            }
            return cur;
          });
        }
        if (l.marginLeftMm !== null && l.marginLeftMm !== undefined) {
          const v = Math.max(3, l.marginLeftMm);
          setMarginLeft((cur) => {
            if (originalsRef.current && cur === originalsRef.current.marginLeft) {
              originalsRef.current.marginLeft = v;
              return v;
            }
            return cur;
          });
        }
        if (l.marginRightMm !== null && l.marginRightMm !== undefined) {
          const v = Math.max(3, l.marginRightMm);
          setMarginRight((cur) => {
            if (originalsRef.current && cur === originalsRef.current.marginRight) {
              originalsRef.current.marginRight = v;
              return v;
            }
            return cur;
          });
        }
        if (l.showTableNumber !== null && l.showTableNumber !== undefined) {
          const val = l.showTableNumber;
          setShowTableNumber((cur) => {
            if (originalsRef.current && cur === originalsRef.current.showTableNumber) {
              originalsRef.current.showTableNumber = val;
              return val;
            }
            return cur;
          });
        }
        if (l.footerNote !== null && l.footerNote !== undefined) {
          const val = l.footerNote;
          setFooter((cur) => {
            if (originalsRef.current && cur === originalsRef.current.footer) {
              originalsRef.current.footer = val;
              return val;
            }
            return cur;
          });
        }
        if (eff.content) {
          const content = eff.content;
          setShowTax((cur) => {
            if (originalsRef.current && cur === originalsRef.current.showTax) {
              originalsRef.current.showTax = content.showTax;
              return content.showTax;
            }
            return cur;
          });
          setShowCurrency((cur) => {
            if (originalsRef.current && cur === originalsRef.current.showCurrency) {
              originalsRef.current.showCurrency = content.showCurrency;
              return content.showCurrency;
            }
            return cur;
          });
        }
        setDirtyVersion((v) => v + 1);
      } catch {
        // No scoped format (or no permission): the legacy values stand.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, effectiveTerminalId]);

  // Sync hardware settings when profile arrives
  useEffect(() => {
    if (hwInitializedRef.current || !hw.profile) return;
    const p = hw.profile.hardware.printer;
    const kp = hw.profile.hardware.kitchenPrinter;
    const paperSize = p.paperSize === '58' ? '58' : '80';
    setPrinterConnection(p.connection);
    setPrinterDevicePath(p.devicePath ?? '');
    setPrinterPaperSize(paperSize);
    setKitchenConnection(kp.connection);
    setKitchenDevicePath(kp.devicePath ?? '');

    if (originalsRef.current) {
      originalsRef.current.printerConnection = p.connection;
      originalsRef.current.printerDevicePath = p.devicePath ?? '';
      originalsRef.current.printerPaperSize = paperSize;
      originalsRef.current.kitchenConnection = kp.connection;
      originalsRef.current.kitchenDevicePath = kp.devicePath ?? '';
    }
    hwInitializedRef.current = true;
    setDirtyVersion((v) => v + 1);
  }, [hw.profile]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    if (!loaded || !originalsRef.current) return false;
    const current: ReceiptFormValues = {
      paperWidth,
      fontSize,
      showCurrency,
      showThousandsSeparator,
      showDecimals,
      showTax,
      showTableNumber,
      taxRoundingMode,
      footer,
      showReceiptCode,
      showDateTime,
      showStaffName,
      showFooter,
      showItemNotes,
      taxRatePercent,
      businessLogo,
      logoPosition,
      headerTitle,
      headerLine1,
      headerLine2,
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
    const orig = originalsRef.current;
    return (Object.keys(current) as (keyof ReceiptFormValues)[]).some((k) => current[k] !== orig[k]);
  }, [
    loaded,
    dirtyVersion,
    paperWidth,
    fontSize,
    showCurrency,
    showThousandsSeparator,
    showDecimals,
    showTax,
    showTableNumber,
    taxRoundingMode,
    footer,
    showReceiptCode,
    showDateTime,
    showStaffName,
    showFooter,
    showItemNotes,
    taxRatePercent,
    businessLogo,
    logoPosition,
    headerTitle,
    headerLine1,
    headerLine2,
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
    const conn = v as 'auto' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'disabled';
    setPrinterConnection(conn);
    hw.updatePrinter({ connection: conn });
    if (conn === 'bluetooth') {
      const win = window as unknown as {
        __kasirmuNative?: {
          hasBluetoothPermissions?: () => boolean;
          requestBluetoothPermissions?: () => void;
        };
      };
      if (win.__kasirmuNative?.hasBluetoothPermissions && !win.__kasirmuNative.hasBluetoothPermissions()) {
        win.__kasirmuNative.requestBluetoothPermissions?.();
      }
    }
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
    const conn = v as 'disabled' | 'network' | 'usb' | 'serial' | 'bluetooth' | 'auto';
    setKitchenConnection(conn);
    hw.updateKitchenPrinter({ connection: conn });
    if (conn === 'bluetooth') {
      const win = window as unknown as {
        __kasirmuNative?: {
          hasBluetoothPermissions?: () => boolean;
          requestBluetoothPermissions?: () => void;
        };
      };
      if (win.__kasirmuNative?.hasBluetoothPermissions && !win.__kasirmuNative.hasBluetoothPermissions()) {
        win.__kasirmuNative.requestBluetoothPermissions?.();
      }
    }
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
    // 1. Pre-flight check: authentication session
    if (!sessionToken) {
      const res = formatTestPrintResult(TEST_PRINT_CODES.ERR_AUTH_REQUIRED);
      setTestPrintResult({ ...res, timestamp: Date.now() });
      addToast({
        title: `[${res.code}] Print Error`,
        message: res.message,
        type: 'error',
      });
      return;
    }

    // 2. Pre-flight check: printer connection enabled
    if (printerConnection === 'disabled') {
      const res = formatTestPrintResult(TEST_PRINT_CODES.ERR_PRINTER_DISABLED);
      setTestPrintResult({ ...res, timestamp: Date.now() });
      addToast({
        title: `[${res.code}] Print Error`,
        message: res.message,
        type: 'error',
      });
      return;
    }

    // 3. Pre-flight check: network printer must have IP / host
    if (printerConnection === 'network' && !printerDevicePath.trim()) {
      const res = formatTestPrintResult(TEST_PRINT_CODES.ERR_MISSING_HOST);
      setTestPrintResult({ ...res, timestamp: Date.now() });
      addToast({
        title: `[${res.code}] Print Error`,
        message: res.message,
        type: 'error',
      });
      return;
    }

    // 4. Pre-flight check: USB/Serial/Bluetooth printer path
    if ((printerConnection === 'usb' || printerConnection === 'serial' || printerConnection === 'bluetooth') && !printerDevicePath.trim()) {
      const res = formatTestPrintResult(TEST_PRINT_CODES.ERR_MISSING_PORT);
      setTestPrintResult({ ...res, timestamp: Date.now() });
      addToast({
        title: `[${res.code}] Print Error`,
        message: printerConnection === 'bluetooth' ? 'Bluetooth MAC address is required' : res.message,
        type: 'error',
      });
      return;
    }

    if (dirty) {
      addToast({
        title: 'Unsaved Changes',
        message: 'Test print uses last saved settings. Save changes to apply your draft layout.',
        type: 'warning',
      });
    }

    setTestingPrint(true);
    setTestPrintResult(null);
    const start = Date.now();
    try {
      const currency = settings.store.currency || 'IDR';
      const printRes = await printSalesReceipt(sessionToken, {
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
            ...(showItemNotes ? { note: 'pedas' } : {}),
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
        ...(tablesEnabled && showTableNumber ? { tableNumber: 'Table 1' } : {}),
      });

      const elapsed = Date.now() - start;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      if (printRes && printRes.printed === false) {
        const res = formatTestPrintResult(TEST_PRINT_CODES.ERR_UNCONFIRMED);
        setTestPrintResult({ ...res, timestamp: Date.now() });
        addToast({
          title: `[${res.code}] Print Error`,
          message: res.message,
          type: 'error',
        });
      } else {
        const res = formatTestPrintResult(TEST_PRINT_CODES.SUCCESS);
        setTestPrintResult({ ...res, timestamp: Date.now() });
        addToast({
          title: `[${res.code}] Print Success`,
          message: res.message,
          type: 'success',
        });
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      const classified = classifyTestPrintError(err);
      const res = formatTestPrintResult(classified.code, classified.detail);
      setTestPrintResult({ ...res, timestamp: Date.now() });
      addToast({
        title: `[${res.code}] Print Error`,
        message: res.message,
        type: 'error',
      });
    } finally {
      setTestingPrint(false);
    }
  }, [
    sessionToken,
    printerConnection,
    printerDevicePath,
    settings.store.currency,
    showTax,
    taxRatePercent,
    tablesEnabled,
    showTableNumber,
    showItemNotes,
    addToast,
    dirty,
  ]);

  // ── Test Cash Drawer ─────────────────────────────────────────
  const handleTestDrawer = useCallback(async () => {
    if (!sessionToken) {
      addToast({
        title: 'Authentication Required',
        message: 'Authentication session required to open cash drawer',
        type: 'error',
      });
      return;
    }

    setTestingDrawer(true);
    try {
      const res = await openCashDrawerScoped(sessionToken);
      if (res && res.opened !== false) {
        addToast({
          title: 'Drawer Signal Sent',
          message: 'Cash drawer kick pulse sent to default printer',
          type: 'success',
        });
      } else {
        addToast({
          title: 'Drawer Kick Unconfirmed',
          message: 'Device did not confirm drawer open',
          type: 'warning',
        });
      }
    } catch (err) {
      addToast({
        title: 'Drawer Kick Failed',
        // ERR-05: the drawer-kick failure text is backend hardware detail; render
        // the screen's own localized copy instead of surfacing it verbatim.
        message: l10nErrorMessage(err, l10n, 'receipts-drawer-kick-failed'),
        type: 'error',
      });
    } finally {
      setTestingDrawer(false);
    }
  }, [sessionToken, addToast, l10n]);

  // ── Save handler ────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    const start = Date.now();
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
          showTableNumber: tablesEnabled ? showTableNumber : false,
          marginTop,
          marginBottom,
          marginLeft,
          marginRight,
          taxRoundingMode,
        }),
      );

      // 2. Save the SCOPED layout (the layer the printed receipt actually
      //    resolves through, shared with Settings → Business Defaults). Only
      //    the fields this screen owns are written; null leaves the other
      //    layers untouched. Skipped when no workspace scope was resolved, so
      //    the legacy write above remains the sole (fallback) writer.
      if (sessionToken && receiptWorkspaceId) {
        tasks.push(
          setReceiptLayoutScoped(sessionToken, receiptWorkspaceId, {
            paperWidthMm: paperWidth === 'narrow' ? 58 : 80,
            marginTopMm: marginTop,
            marginBottomMm: marginBottom,
            marginLeftMm: marginLeft,
            marginRightMm: marginRight,
            showLogo: null,
            printCopies: null,
            showTableNumber: tablesEnabled ? showTableNumber : false,
            footerNote: showFooter ? footer : '',
          }),
        );
      }

      // 3. Save device hardware profile
      if (effectiveTerminalId && hw.profile) {
        tasks.push(hw.save());
      }

      // 4. Save extended toggles & preferences
      if (sessionToken) {
        tasks.push(
          setUserPreferencesScoped(sessionToken, [
            { key: 'resto_rcpt_header_title', value: headerTitle },
            { key: 'resto_rcpt_header_line1', value: headerLine1 },
            { key: 'resto_rcpt_header_line2', value: headerLine2 },
            { key: 'resto_rcpt_font_size', value: fontSize },
            { key: 'resto_rcpt_show_code', value: String(showReceiptCode) },
            { key: 'resto_rcpt_show_dt', value: String(showDateTime) },
            { key: 'resto_rcpt_show_staff', value: String(showStaffName) },
            { key: 'resto_rcpt_show_footer', value: String(showFooter) },
            { key: 'resto_rcpt_show_item_notes', value: String(showItemNotes) },
            { key: 'resto_rcpt_thousands_sep', value: String(showThousandsSeparator) },
            { key: 'resto_rcpt_show_decimals', value: String(showDecimals) },
            { key: 'resto_rcpt_tax_rate', value: String(taxRatePercent) },
            { key: 'resto_rcpt_logo', value: businessLogo },
            { key: 'resto_rcpt_logo_pos', value: logoPosition },
          ]),
        );
      }

      await Promise.all(tasks);

      // Cache to localStorage for instantaneous client load — AFTER the writes
      // resolve, not before (F5, the same defect fixed in
      // RestaurantSettingsScreen). Writing the cache first meant a REJECTED save
      // left localStorage holding the new values while the DB still held the old
      // ones, so the next mount would render the un-persisted edit as if it had
      // been saved. Doing it after the await keeps the cache consistent with what
      // actually committed.
      try {
        localStorage.setItem('resto_rcpt_header_title', headerTitle);
        localStorage.setItem('resto_rcpt_header_line1', headerLine1);
        localStorage.setItem('resto_rcpt_header_line2', headerLine2);
        localStorage.setItem('resto_rcpt_font_size', fontSize);
        localStorage.setItem('resto_rcpt_show_code', String(showReceiptCode));
        localStorage.setItem('resto_rcpt_show_dt', String(showDateTime));
        localStorage.setItem('resto_rcpt_show_staff', String(showStaffName));
        localStorage.setItem('resto_rcpt_show_footer', String(showFooter));
        localStorage.setItem('resto_rcpt_show_item_notes', String(showItemNotes));
        localStorage.setItem('resto_rcpt_thousands_sep', String(showThousandsSeparator));
        localStorage.setItem('resto_rcpt_show_decimals', String(showDecimals));
        localStorage.setItem('resto_rcpt_tax_rate', String(taxRatePercent));
        localStorage.setItem('resto_rcpt_logo', businessLogo);
        localStorage.setItem('resto_rcpt_logo_pos', logoPosition);
      } catch {
        // Safe to ignore
      }

      originalsRef.current = {
        paperWidth,
        fontSize,
        showCurrency,
        showThousandsSeparator,
        showDecimals,
        showTax,
        showTableNumber,
        taxRoundingMode,
        footer,
        showReceiptCode,
        showDateTime,
        showStaffName,
        showFooter,
        showItemNotes,
        taxRatePercent,
        businessLogo,
        logoPosition,
        headerTitle,
        headerLine1,
        headerLine2,
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

      const elapsed = Date.now() - start;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      addToast({
        message: l10n.getString('restaurant-save-success'),
        type: 'success',
      });

      onSaved?.();
    } catch {
      const elapsed = Date.now() - start;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }
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
    receiptWorkspaceId,
    hw,
    showCurrency,
    showThousandsSeparator,
    showDecimals,
    settings.receipt.decimalSeparator,
    showTax,
    showFooter,
    footer,
    paperWidth,
    fontSize,
    tablesEnabled,
    showTableNumber,
    showReceiptCode,
    showDateTime,
    showStaffName,
    showItemNotes,
    taxRatePercent,
    businessLogo,
    logoPosition,
    headerTitle,
    headerLine1,
    headerLine2,
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

  // ── Back navigation guard ────────────────────────────────────
  // If there are unsaved changes, intercept back/Escape and show the
  // three-button confirmation dialog instead of navigating immediately.
  const handleRequestBack = useCallback(() => {
    if (dirty) {
      setShowUnsavedDialog(true);
    } else {
      onBack?.();
    }
  }, [dirty, onBack]);

  // Trap Escape key so it routes through the same guard.
  useEffect(() => {
    if (!onBack) return; // only active when a back destination exists
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't intercept if a modal/dropdown is already open and handling it.
      if ((e.target as HTMLElement)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      handleRequestBack();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onBack, handleRequestBack]);

  // ── Accurate Calculations for Thermal Preview ───────────────
  // These values are computed by the pure `receiptLogic` module (unit-tested);
  // the JSX below reads the same names as before the extraction.
  const rollWidthMm = paperRollWidth(paperWidth);
  const printableAreaMm = areaMm(rollWidthMm, marginLeft, marginRight);
  const approxCols = useMemo(
    () => colsFor(paperWidth, printableAreaMm, fontSize),
    [paperWidth, printableAreaMm, fontSize],
  );

  const effectiveDecimalSeparator: DecimalSeparator =
    (settings.store.currency || 'IDR') === 'IDR'
      ? 'comma'
      : ((settings.receipt.decimalSeparator as DecimalSeparator) ?? 'dot');

  const formatPrice = (amount: number) =>
    _formatPrice(
      amount,
      showCurrency,
      settings.store.currency,
      effectiveDecimalSeparator,
      showDecimals ? 2 : 0,
      showThousandsSeparator,
    );

  // Sample gross prices: Nasi Goreng (35.000), Es Teh Manis (16.000), Ayam Bakar (42.000)
  // When showTax is true, line items show net price = 100/(100 + taxRatePercent) of gross,
  // rounded for display (e.g. 16.000 * 100 / 110 = 14545.4545... -> shown as 14.545),
  // while exact fractional parts are preserved in the subtotal and raw tax inside
  // computeReceiptPreview.
  const preview = computeReceiptPreview({ taxRatePercent, showTax, taxRoundingMode });
  const [sampleItem1Price, sampleItem2Price, sampleItem3Price] = preview.itemPrices;
  const sampleSubtotal = preview.subtotal;
  const sampleTax = preview.tax;
  const sampleTotal = preview.total;
  const sampleCash = 100000;
  const sampleChange = preview.change;

  return (
    <div className="restaurant-settings-screen">
      <div className="restaurant-settings-header" data-testid="restaurant-receipts-header">
        <div className="restaurant-settings-header-lead">
          {onBack && (
            <button
              type="button"
              className="restaurant-settings-back-btn"
              onClick={handleRequestBack}
              aria-label={l10n.getString('back') || 'Back'}
              data-testid="restaurant-receipts-back-btn"
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
              data-testid="restaurant-receipts-icon"
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
                <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
                <path d="M8 7h8M8 11h8M8 15h5" />
              </svg>
            </span>
            <Localized id="restaurant-receipts-title">
              <h1 className="restaurant-settings-title" data-testid="restaurant-receipts-title">
                Receipt &amp; Printer Settings
              </h1>
            </Localized>
          </div>
        </div>

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
            data-testid="restaurant-receipts-save-btn"
          >
            <span className="resto-anim-btn__spinner-wrap" aria-hidden="true">
              <span className="resto-anim-btn__spinner" />
            </span>
            <span className="resto-anim-btn__content">
              <Localized id="save">Save Changes</Localized>
            </span>
          </button>
        </div>
      </div>

      <div className="restaurant-settings-main">
      <div className="restaurant-settings-layout">
        {/* ── Left Column: Live Accurate Thermal Receipt Preview ── */}
        <aside
          className="restaurant-preview-column"
          aria-label={l10n.getString('restaurant-preview-title') || 'Print Preview'}
        >
          <div className="restaurant-preview-card noise-dither">
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
                className={`resto-receipt-paper resto-receipt-paper--${paperWidth === 'narrow' ? '58mm' : '80mm'} ${fontSizeClass(fontSize)}`}
                style={{
                  paddingTop: `${marginTop}mm`,
                  paddingBottom: `${marginBottom}mm`,
                  paddingLeft: `${marginLeft}mm`,
                  paddingRight: `${marginRight}mm`,
                }}
              >
                <div className="resto-receipt-printable-area">
                  {/* Store Header with Logo */}
                  {businessLogo ? (
                    logoPosition === 'top' ? (
                      <div className="resto-receipt-center">
                        <div className="resto-receipt-logo-wrap">
                          <img src={businessLogo} alt="Business logo" className="resto-receipt-logo" />
                        </div>
                        <div className="resto-receipt-store-title">
                          {headerTitle.trim() || (settings.store.name ? settings.store.name.toUpperCase() : 'KASIR.MU RESTAURANT')}
                        </div>
                        {headerLine1.trim() && (
                          <div className="resto-receipt-header-line">
                            {headerLine1.trim()}
                          </div>
                        )}
                        {headerLine2.trim() && (
                          <div className="resto-receipt-header-line">
                            {headerLine2.trim()}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className={`resto-receipt-header-row ${logoPosition === 'right' ? 'resto-receipt-header-row--right' : ''}`}>
                        <div className="resto-receipt-header-logo-col">
                          <img src={businessLogo} alt="Business logo" className="resto-receipt-logo" />
                        </div>
                        <div className="resto-receipt-header-text-col">
                          <div className="resto-receipt-store-title">
                            {headerTitle.trim() || (settings.store.name ? settings.store.name.toUpperCase() : 'KASIR.MU RESTAURANT')}
                          </div>
                          {headerLine1.trim() && (
                            <div className="resto-receipt-header-line">
                              {headerLine1.trim()}
                            </div>
                          )}
                          {headerLine2.trim() && (
                            <div className="resto-receipt-header-line">
                              {headerLine2.trim()}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="resto-receipt-center">
                      <div className="resto-receipt-store-title">
                        {headerTitle.trim() || (settings.store.name ? settings.store.name.toUpperCase() : 'KASIR.MU RESTAURANT')}
                      </div>
                      {headerLine1.trim() && (
                        <div className="resto-receipt-header-line">
                          {headerLine1.trim()}
                        </div>
                      )}
                      {headerLine2.trim() && (
                        <div className="resto-receipt-header-line">
                          {headerLine2.trim()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Metadata (Date/Time, Staff, Code, Table) */}
                  {(() => {
                    const hasTablePill = tablesEnabled && showTableNumber;
                    const tablePill = hasTablePill ? <span className="resto-receipt-table-pill">TABLE 4</span> : null;
                    const staffSpan = showStaffName ? <span>{staffDisplayName}</span> : null;
                    const codeSpan = showReceiptCode ? <span>01-01-260929-01-000042</span> : null;
                    const dateSpan = showDateTime ? <span>29/09/2026 21:15</span> : null;

                    let row1Left = null;
                    let row1Right = null;
                    let row2Left = null;
                    let row2Right = null;

                    if (showDateTime) {
                      row1Left = dateSpan;
                      row1Right = staffSpan;
                      row2Left = codeSpan;
                      row2Right = tablePill;
                    } else {
                      // When datetime is not enabled, use the first row
                      row1Left = codeSpan;
                      if (staffSpan) {
                        row1Right = staffSpan;
                        row2Right = tablePill;
                      } else {
                        row1Right = tablePill;
                      }
                    }

                    const hasRow1 = row1Left !== null || row1Right !== null;
                    const hasRow2 = row2Left !== null || row2Right !== null;

                    if (!hasRow1 && !hasRow2) return null;

                    return (
                      <div className="resto-receipt-center">
                        {hasRow1 && (
                          <div className="resto-receipt-meta">
                            {row1Left || <span />}
                            {row1Right || <span />}
                          </div>
                        )}
                        {hasRow2 && (
                          <div className="resto-receipt-meta" style={{ marginTop: '2px' }}>
                            {row2Left || <span />}
                            {row2Right || <span />}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="resto-receipt-divider" />

                  {/* Line Items */}
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">1x Nasi Goreng Spesial</span>
                    <span className="resto-receipt-item-price">{formatPrice(sampleItem1Price)}</span>
                  </div>
                  {showItemNotes && (
                    <div className="resto-receipt-item-note">pedas</div>
                  )}
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">2x Es Teh Manis</span>
                    <span className="resto-receipt-item-price">{formatPrice(sampleItem2Price)}</span>
                  </div>
                  <div className="resto-receipt-item-row">
                    <span className="resto-receipt-item-name">1x Ayam Bakar Madu</span>
                    <span className="resto-receipt-item-price">{formatPrice(sampleItem3Price)}</span>
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
                        <span>PB1/TAX ({taxRatePercent}%)</span>
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
                      <div className={`resto-receipt-footer-text ${!footer.trim() ? 'resto-receipt-footer-text--placeholder' : ''}`}>
                        {footer.trim()
                          ? footer
                          : l10n.getString('restaurant-footer-placeholder') || 'Thank you for dining with us!'}
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

            {/* Test Print Button under preview — animated centered loading replacing text */}
            <button
              type="button"
              className={`resto-test-print-btn resto-anim-btn ${testingPrint ? 'resto-anim-btn--loading' : ''}`}
              disabled={testingPrint}
              aria-busy={testingPrint || undefined}
              onClick={handleTestPrint}
              data-testid="restaurant-receipts-test-print-btn"
            >
              <span className="resto-anim-btn__spinner-wrap" aria-hidden="true">
                <span className="resto-anim-btn__spinner" />
              </span>
              <span className="resto-anim-btn__content resto-test-print-label">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                <Localized id="restaurant-test-print">Test Print Receipt</Localized>
              </span>
            </button>

            {/* Test Cash Drawer Button */}
            <button
              type="button"
              className={`resto-test-print-btn resto-anim-btn ${testingDrawer ? 'resto-anim-btn--loading' : ''}`}
              disabled={testingDrawer}
              aria-busy={testingDrawer || undefined}
              onClick={handleTestDrawer}
              data-testid="restaurant-receipts-test-drawer-btn"
            >
              <span className="resto-anim-btn__spinner-wrap" aria-hidden="true">
                <span className="resto-anim-btn__spinner" />
              </span>
              <span className="resto-anim-btn__content resto-test-print-label">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="16"
                  height="16"
                  aria-hidden="true"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <circle cx="12" cy="16" r="1.5" />
                </svg>
                <Localized id="restaurant-test-drawer">Test Cash Drawer</Localized>
              </span>
            </button>

            {/* Test Print Result Status Card */}
            {testPrintResult && (
              <div
                className={`resto-test-print-status resto-test-print-status--${testPrintResult.type}`}
                role="status"
                aria-live="polite"
                data-testid="restaurant-receipts-test-print-status"
              >
                <div className="resto-test-print-status__badge-row">
                  <span className="resto-test-print-status__badge">
                    {testPrintResult.code}
                  </span>
                  <span className="resto-test-print-status__label">
                    {testPrintResult.type === 'success' ? 'SUCCESS' : 'ERROR'}
                  </span>
                </div>
                <p className="resto-test-print-status__msg">
                  {testPrintResult.message}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* ── Right Column: Configuration Controls ──────────── */}
        <main className="restaurant-settings-column">
          <div className="restaurant-settings-grid">
            {/* ── Configuration Column 1: Paper, Content, Footer ── */}
            <div className="restaurant-settings-grid-col">
              {/* ── Card 1: Paper & Layout ────────────────────────── */}
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-paper-layout-heading">Paper &amp; Layout</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-paper-layout-sub">Paper width, font scale, and margins</Localized>
                      </p>
                    </div>
                  </div>
                }
              >
                {/* Paper Width Segmented Control */}
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>
                    <Localized id="workspace-pos-paper-width">Paper Width</Localized>
                  </div>
                  <div className="resto-segmented-group" role="group" aria-label={l10n.getString('workspace-pos-paper-width') || 'Paper Width'}>
                    <button
                      type="button"
                      className={`resto-segmented-btn ${paperWidth === 'narrow' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setPaperWidth('narrow')}
                    >
                      <Localized id="restaurant-preview-paper-width-narrow">58 mm (Compact)</Localized>
                    </button>
                    <button
                      type="button"
                      className={`resto-segmented-btn ${paperWidth === 'standard' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setPaperWidth('standard')}
                    >
                      <Localized id="restaurant-preview-paper-width-standard">80 mm (Standard)</Localized>
                    </button>
                  </div>
                </div>

                {/* Font Size Segmented Control (Very Small, Small, Medium, Large) */}
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div className="resto-toggle-title" style={{ marginBottom: '6px' }}>
                    <Localized id="restaurant-rcpt-font-size-heading">Font Size</Localized>
                  </div>
                  <div
                    className="resto-segmented-group resto-segmented-group--4"
                    role="group"
                    aria-label={l10n.getString('restaurant-rcpt-font-size-heading') || 'Font Size'}
                  >
                    <button
                      type="button"
                      className={`resto-segmented-btn ${fontSize === 'very_small' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setFontSize('very_small')}
                    >
                      <Localized id="restaurant-rcpt-font-size-very-small">Very Small</Localized>
                    </button>
                    <button
                      type="button"
                      className={`resto-segmented-btn ${fontSize === 'small' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setFontSize('small')}
                    >
                      <Localized id="restaurant-rcpt-font-size-small">Small</Localized>
                    </button>
                    <button
                      type="button"
                      className={`resto-segmented-btn ${fontSize === 'medium' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setFontSize('medium')}
                    >
                      <Localized id="restaurant-rcpt-font-size-medium">Medium</Localized>
                    </button>
                    <button
                      type="button"
                      className={`resto-segmented-btn ${fontSize === 'large' ? 'resto-segmented-btn--active' : ''}`}
                      onClick={() => setFontSize('large')}
                    >
                      <Localized id="restaurant-rcpt-font-size-large">Large</Localized>
                    </button>
                  </div>
                </div>

                {/* Paper Margins (3-30mm top/bottom, 3-15mm left/right) */}
                <div>
                  <div className="resto-toggle-title">
                    <Localized id="restaurant-margins-heading">Paper Margins (mm)</Localized>
                  </div>
                  <div className="resto-margins-grid">
                    {/* Margin Top (3-30 mm) */}
                    <div className="resto-margin-card">
                      <div className="resto-margin-header">
                        <label htmlFor="resto-margin-top" className="resto-margin-label">
                          <Localized id="restaurant-margin-top">Top</Localized>
                        </label>
                        <span className="resto-margin-range">3 – 30 mm</span>
                      </div>
                      <div className="resto-margin-input-wrap">
                        <input
                          id="resto-margin-top"
                          type="number"
                          className="resto-margin-input"
                          min={3}
                          max={30}
                          value={marginTop}
                          onChange={(e) => setMarginTop(clamp(Number(e.target.value), 3, 30))}
                        />
                        <span className="resto-margin-unit">mm</span>
                      </div>
                    </div>

                    {/* Margin Bottom (3-30 mm) */}
                    <div className="resto-margin-card">
                      <div className="resto-margin-header">
                        <label htmlFor="resto-margin-bottom" className="resto-margin-label">
                          <Localized id="restaurant-margin-bottom">Bottom</Localized>
                        </label>
                        <span className="resto-margin-range">3 – 30 mm</span>
                      </div>
                      <div className="resto-margin-input-wrap">
                        <input
                          id="resto-margin-bottom"
                          type="number"
                          className="resto-margin-input"
                          min={3}
                          max={30}
                          value={marginBottom}
                          onChange={(e) => setMarginBottom(clamp(Number(e.target.value), 3, 30))}
                        />
                        <span className="resto-margin-unit">mm</span>
                      </div>
                    </div>

                    {/* Margin Left (3-15 mm) */}
                    <div className="resto-margin-card">
                      <div className="resto-margin-header">
                        <label htmlFor="resto-margin-left" className="resto-margin-label">
                          <Localized id="restaurant-margin-left">Left</Localized>
                        </label>
                        <span className="resto-margin-range">3 – 15 mm</span>
                      </div>
                      <div className="resto-margin-input-wrap">
                        <input
                          id="resto-margin-left"
                          type="number"
                          className="resto-margin-input"
                          min={3}
                          max={15}
                          value={marginLeft}
                          onChange={(e) => setMarginLeft(clamp(Number(e.target.value), 3, 15))}
                        />
                        <span className="resto-margin-unit">mm</span>
                      </div>
                    </div>

                    {/* Margin Right (3-15 mm) */}
                    <div className="resto-margin-card">
                      <div className="resto-margin-header">
                        <label htmlFor="resto-margin-right" className="resto-margin-label">
                          <Localized id="restaurant-margin-right">Right</Localized>
                        </label>
                        <span className="resto-margin-range">3 – 15 mm</span>
                      </div>
                      <div className="resto-margin-input-wrap">
                        <input
                          id="resto-margin-right"
                          type="number"
                          className="resto-margin-input"
                          min={3}
                          max={15}
                          value={marginRight}
                          onChange={(e) => setMarginRight(clamp(Number(e.target.value), 3, 15))}
                        />
                        <span className="resto-margin-unit">mm</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* ── Card 2: Display Options ───────────────────────── */}
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-display-options-heading">Display Options</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-display-options-sub">Content elements shown on receipt</Localized>
                      </p>
                    </div>
                  </div>
                }
              >
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
                    <span className="resto-switch-handle" aria-hidden="true" />
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
                    <span className="resto-switch-handle" aria-hidden="true" />
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
                    <span className="resto-switch-handle" aria-hidden="true" />
                  </button>
                </div>

                {/* Toggle: Table Number (only if table management is enabled in resto pos) */}
                {tablesEnabled && (
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
                      <span className="resto-switch-handle" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* Toggle: Menu Order Notes */}
                <div className="resto-toggle-row">
                  <div className="resto-toggle-info">
                    <span className="resto-toggle-title">
                      <Localized id="restaurant-toggle-item-notes">Show Menu Order Notes</Localized>
                    </span>
                    <span className="resto-toggle-desc">
                      <Localized id="restaurant-toggle-item-notes-desc">
                        Print cooking requests and special item notes under menu items
                      </Localized>
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showItemNotes}
                    aria-label={l10n.getString('restaurant-toggle-item-notes') || 'Show Menu Order Notes'}
                    className="resto-switch-btn"
                    onClick={() => setShowItemNotes(!showItemNotes)}
                  >
                    <span className="resto-switch-handle" aria-hidden="true" />
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
                    <span className="resto-switch-handle" aria-hidden="true" />
                  </button>
                </div>

                {/* Toggle: Thousands Separator */}
                <div className="resto-toggle-row">
                  <div className="resto-toggle-info">
                    <span className="resto-toggle-title">
                      <Localized id="restaurant-toggle-thousands-sep">Show Thousands Separator</Localized>
                    </span>
                    <span className="resto-toggle-desc">
                      <Localized id="restaurant-toggle-thousands-sep-desc">
                        Format amounts with thousands separators (e.g. 10.000 vs 10000)
                      </Localized>
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showThousandsSeparator}
                    aria-label={l10n.getString('restaurant-toggle-thousands-sep') || 'Show Thousands Separator'}
                    className="resto-switch-btn"
                    onClick={() => setShowThousandsSeparator(!showThousandsSeparator)}
                  >
                    <span className="resto-switch-handle" aria-hidden="true" />
                  </button>
                </div>

                {/* Toggle: Show Decimals */}
                <div className="resto-toggle-row">
                  <div className="resto-toggle-info">
                    <span className="resto-toggle-title">
                      <Localized id="restaurant-toggle-decimals">Show Decimals</Localized>
                    </span>
                    <span className="resto-toggle-desc">
                      <Localized id="restaurant-toggle-decimals-desc">
                        Print cents and fractional units (e.g. ,00)
                      </Localized>
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showDecimals}
                    aria-label={l10n.getString('restaurant-toggle-decimals') || 'Show Decimals'}
                    className="resto-switch-btn"
                    onClick={() => setShowDecimals(!showDecimals)}
                  >
                    <span className="resto-switch-handle" aria-hidden="true" />
                  </button>
                </div>
              </Card>

              {/* ── Card 3: Footer & Notice ───────────────────────── */}
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-footer-heading">Footer &amp; Notice</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-footer-sub">Closing notes and plan tier information</Localized>
                      </p>
                    </div>
                  </div>
                }
              >
                {/* Toggle: Footer Note */}
                <div className="resto-toggle-row">
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
                    <span className="resto-switch-handle" aria-hidden="true" />
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
                      Free Plan: &ldquo;kasir.mu&rdquo; is always printed after footer
                    </Localized>
                  ) : (
                    <Localized id="restaurant-paid-tier-watermark-notice">
                      Paid Plan: Watermark removed
                    </Localized>
                  )}
                </div>
              </Card>
            </div>

            {/* ── Configuration Column 2: Header, Tax, Printers ─── */}
            <div className="restaurant-settings-grid-col">
              {/* ── Card 4: Header & Branding ───────────────────── */}
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-header-branding-heading">Header &amp; Branding</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-header-branding-sub">Logo and store header text</Localized>
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
                        <img
                          src={businessLogo}
                          alt={l10n.getString('restaurant-logo-preview-alt')}
                          className="resto-logo-thumb"
                        />
                      ) : (
                        <span style={{ fontSize: '10px', color: 'var(--color-fg-muted)' }}>
                          <Localized id="restaurant-logo-no-logo"><span>No logo</span></Localized>
                        </span>
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
                          size="md"
                          className="resto-logo-upload-btn"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Localized id="restaurant-logo-upload-btn">Choose Logo</Localized>
                        </Button>
                        {businessLogo && (
                          <Button
                            variant="ghost"
                            size="md"
                            className="resto-logo-remove-btn"
                            onClick={() => setBusinessLogo('')}
                          >
                            <Localized id="restaurant-logo-remove-btn">Remove Logo</Localized>
                          </Button>
                        )}
                      </div>
                      <input
                        type="text"
                        className="resto-text-input"
                        placeholder={l10n.getString('restaurant-logo-url-placeholder') || 'Or paste Image URL / SVG code'}
                        value={
                          businessLogo.startsWith('data:') && !businessLogo.startsWith('data:image/svg+xml;utf8,')
                            ? 'Custom uploaded image'
                            : businessLogo
                        }
                        onFocus={(e) => {
                          if (businessLogo.startsWith('data:') && !businessLogo.startsWith('data:image/svg+xml;utf8,')) {
                            e.target.select();
                          }
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || !val.startsWith('Custom uploaded')) {
                            setBusinessLogo(normalizeLogoInput(val));
                          }
                        }}
                      />
                    </div>
                  </div>

                  {businessLogo && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div className="resto-toggle-desc" style={{ marginBottom: '4px', fontWeight: 500 }}>
                        <Localized id="restaurant-logo-position-heading">Logo Position</Localized>
                      </div>
                      <div
                        className="resto-segmented-group"
                        role="group"
                        aria-label={l10n.getString('restaurant-logo-position-heading')}
                      >
                        <button
                          type="button"
                          className={`resto-segmented-btn ${logoPosition === 'left' ? 'resto-segmented-btn--active' : ''}`}
                          onClick={() => setLogoPosition('left')}
                        >
                          <Localized id="restaurant-logo-pos-left">Left</Localized>
                        </button>
                        <button
                          type="button"
                          className={`resto-segmented-btn ${logoPosition === 'top' ? 'resto-segmented-btn--active' : ''}`}
                          onClick={() => setLogoPosition('top')}
                        >
                          <Localized id="restaurant-logo-pos-top">Top</Localized>
                        </button>
                        <button
                          type="button"
                          className={`resto-segmented-btn ${logoPosition === 'right' ? 'resto-segmented-btn--active' : ''}`}
                          onClick={() => setLogoPosition('right')}
                        >
                          <Localized id="restaurant-logo-pos-right">Right</Localized>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Header Configuration (Title, Line 1, Line 2) */}
                <div>
                  <div className="resto-toggle-title" style={{ marginBottom: 'var(--space-2)' }}>
                    <Localized id="restaurant-header-config-heading">Receipt Header Details</Localized>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
                        <label htmlFor="resto-header-title" className="resto-toggle-desc" style={{ fontWeight: 500 }}>
                          <Localized id="restaurant-header-title-label">Receipt Title</Localized>
                        </label>
                        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                          {headerTitle.length}/{MAX_HEADER_TITLE_LENGTH}
                        </span>
                      </div>
                      <input
                        id="resto-header-title"
                        type="text"
                        maxLength={MAX_HEADER_TITLE_LENGTH}
                        className="resto-text-input"
                        placeholder={l10n.getString('restaurant-header-title-placeholder') || 'e.g. KASIR.MU RESTAURANT'}
                        value={headerTitle}
                        onChange={(e) => setHeaderTitle(e.target.value.slice(0, MAX_HEADER_TITLE_LENGTH))}
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
                        <label htmlFor="resto-header-line1" className="resto-toggle-desc" style={{ fontWeight: 500 }}>
                          <Localized id="restaurant-header-line1-label">Header Line 1</Localized>
                        </label>
                        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                          {headerLine1.length}/{MAX_HEADER_LINE_LENGTH}
                        </span>
                      </div>
                      <input
                        id="resto-header-line1"
                        type="text"
                        maxLength={MAX_HEADER_LINE_LENGTH}
                        className="resto-text-input"
                        placeholder={l10n.getString('restaurant-header-line1-placeholder') || 'e.g. Street Address, City'}
                        value={headerLine1}
                        onChange={(e) => setHeaderLine1(e.target.value.slice(0, MAX_HEADER_LINE_LENGTH))}
                      />
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
                        <label htmlFor="resto-header-line2" className="resto-toggle-desc" style={{ fontWeight: 500 }}>
                          <Localized id="restaurant-header-line2-label">Header Line 2 (Optional)</Localized>
                        </label>
                        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                          {headerLine2.length}/{MAX_HEADER_LINE_LENGTH}
                        </span>
                      </div>
                      <input
                        id="resto-header-line2"
                        type="text"
                        maxLength={MAX_HEADER_LINE_LENGTH}
                        className="resto-text-input"
                        placeholder={l10n.getString('restaurant-header-line2-placeholder') || 'e.g. Tel: 021-5551234, IG: @resto'}
                        value={headerLine2}
                        onChange={(e) => setHeaderLine2(e.target.value.slice(0, MAX_HEADER_LINE_LENGTH))}
                      />
                    </div>
                  </div>
                </div>
              </Card>

              {/* ── Card 5: Taxes & Rounding ──────────────────────── */}
              <Card
                shadow="sm"
                header={
                  <div className="restaurant-settings-card-header">
                    <div>
                      <h2 className="settings-section-title">
                        <Localized id="restaurant-tax-heading">Taxes &amp; Rounding</Localized>
                      </h2>
                      <p>
                        <Localized id="restaurant-tax-sub">Tax calculation and rounding rules</Localized>
                      </p>
                    </div>
                  </div>
                }
              >
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
                    <span className="resto-switch-handle" aria-hidden="true" />
                  </button>
                </div>

                {showTax && (
                  <>
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

                    {/* Tax Rounding */}
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="resto-toggle-title" style={{ marginBottom: '4px' }}>
                        <Localized id="workspace-pos-tax-rounding">Tax Rounding</Localized>
                      </div>
                      <div className="resto-toggle-desc" style={{ marginBottom: '6px' }}>
                        <Localized id="restaurant-tax-rounding-desc">
                          Rounding method applied to fractional tax amounts
                        </Localized>
                      </div>
                      <div
                        className="resto-segmented-group"
                        role="group"
                        aria-label={l10n.getString('workspace-pos-tax-rounding') || 'Tax Rounding'}
                      >
                        <button
                          type="button"
                          className={`resto-segmented-btn ${taxRoundingMode === 'half_up' ? 'resto-segmented-btn--active' : ''}`}
                          onClick={() => setTaxRoundingMode('half_up')}
                        >
                          <Localized id="workspace-pos-tax-rounding-halfup">Round Half Up</Localized>
                        </button>
                        <button
                          type="button"
                          className={`resto-segmented-btn ${taxRoundingMode === 'truncate' ? 'resto-segmented-btn--active' : ''}`}
                          onClick={() => setTaxRoundingMode('truncate')}
                        >
                          <Localized id="workspace-pos-tax-rounding-truncate">Truncate (Legacy)</Localized>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </Card>

              {/* ── Card 6: Hardware Printers ──────────────────────── */}
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
                      { value: 'bluetooth', label: 'Bluetooth SPP (Wireless)' },
                      { value: 'network', label: 'Network / Ethernet' },
                      { value: 'usb', label: 'USB' },
                      { value: 'serial', label: 'Serial / COM' },
                      { value: 'disabled', label: 'Disabled' },
                    ]}
                  />
                </div>

                {printerConnection === 'bluetooth' && (
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label htmlFor="resto-hw-printer-path" className="resto-toggle-title">
                        Bluetooth MAC Address
                      </label>
                      {btPermissionsGranted === false && (
                        <button
                          type="button"
                          className="restaurant-settings-back-btn"
                          style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', border: '1px solid var(--color-primary)' }}
                          onClick={() => {
                            const win = window as unknown as {
                              __kasirmuNative?: { requestBluetoothPermissions?: () => void };
                            };
                            win.__kasirmuNative?.requestBluetoothPermissions?.();
                          }}
                        >
                          Grant Bluetooth Permission
                        </button>
                      )}
                    </div>
                    {pairedBtDevices.length > 0 && (
                      <div style={{ marginBottom: '6px' }}>
                        <select
                          className="resto-text-input"
                          style={{ marginBottom: '6px' }}
                          value={pairedBtDevices.some((d) => d.address === printerDevicePath) ? printerDevicePath : ''}
                          onChange={(e) => {
                            if (e.target.value) handlePrinterDevicePathChange(e.target.value);
                          }}
                        >
                          <option value="">-- Select Paired Bluetooth Device --</option>
                          {pairedBtDevices.map((d) => (
                            <option key={d.address} value={d.address}>
                              {d.name} ({d.address})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <input
                      id="resto-hw-printer-path"
                      type="text"
                      className="resto-text-input"
                      placeholder="66:12:34:AB:CD:EF (MAC Address)"
                      value={printerDevicePath}
                      onChange={(e) => handlePrinterDevicePathChange(e.target.value)}
                    />
                  </div>
                )}

                {(printerConnection === 'network' || printerConnection === 'serial' || printerConnection === 'usb') && (
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <label htmlFor="resto-hw-printer-path" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                      {printerConnection === 'network' ? 'Printer IP / Host' : 'Device Port / Path'}
                    </label>
                    <input
                      id="resto-hw-printer-path"
                      type="text"
                      className="resto-text-input"
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
                      { value: '58', label: '58 mm' },
                      { value: '80', label: '80 mm' },
                    ]}
                  />
                </div>

                {/* Kitchen Printer */}
                <div
                  className={!hasKdsFeature ? 'resto-kitchen-printer--disabled' : undefined}
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    paddingTop: 'var(--space-3)',
                    ...(!hasKdsFeature ? { opacity: 0.6 } : {}),
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label htmlFor="resto-hw-kitchen-conn" className="resto-toggle-title">
                      <Localized id="restaurant-kitchen-printer-conn">Kitchen Printer Connection</Localized>
                    </label>
                    {!hasKdsFeature && (
                      <span className="restaurant-preview-badge" style={{ fontSize: '10px' }}>
                        <Localized id="restaurant-kds-plan-required">Pro Plan or KDS Required</Localized>
                      </span>
                    )}
                  </div>
                  {!hasKdsFeature && (
                    <p style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>
                      <Localized id="restaurant-kds-plan-desc">
                        Kitchen printer routing requires a subscription plan with Kitchen Display (KDS) enabled.
                      </Localized>
                    </p>
                  )}
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <SettingsSelect
                      id="resto-hw-kitchen-conn"
                      value={hasKdsFeature ? kitchenConnection : 'disabled'}
                      onChange={handleKitchenConnectionChange}
                      disabled={!hasKdsFeature}
                      options={[
                        { value: 'disabled', label: 'Disabled' },
                        { value: 'bluetooth', label: 'Bluetooth SPP (Wireless)' },
                        { value: 'network', label: 'Network / Ethernet' },
                        { value: 'usb', label: 'USB' },
                        { value: 'serial', label: 'Serial / COM' },
                      ]}
                    />
                  </div>

                  {hasKdsFeature && kitchenConnection !== 'disabled' && (
                    <div>
                      <label htmlFor="resto-hw-kitchen-path" className="resto-toggle-title" style={{ display: 'block', marginBottom: '4px' }}>
                        Kitchen Printer IP / Device Path
                      </label>
                      <input
                        id="resto-hw-kitchen-path"
                        type="text"
                        className="resto-text-input"
                        placeholder={kitchenConnection === 'network' ? '192.168.1.101:9100' : kitchenConnection === 'bluetooth' ? '66:12:34:AB:CD:EF' : 'COM4'}
                        value={kitchenDevicePath}
                        onChange={(e) => handleKitchenDevicePathChange(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </main>
      </div>
      </div>

      {/* Unsaved-changes guard dialog — shown when back/Escape is triggered with a dirty form */}
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
