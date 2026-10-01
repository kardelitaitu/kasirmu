import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import {
  getSettingScoped,
  setSettingsScoped,
  getReceiptSettingsScoped,
  setReceiptSettingsScoped,
} from '@/api/settings';
import {
  isInteractionSoundEnabled,
  isInteractionVibrationEnabled,
  setInteractionSoundEnabled,
  setInteractionVibrationEnabled,
} from '@/utils/interaction';
import './RestaurantSettingsScreens.css';

// ── Icons ───────────────────────────────────────────────────────────

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function OrderEntryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function TabsWorkflowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function KitchenBellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function InteractionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18" aria-hidden="true">
      <path d="M18 8a6 6 0 0 1 0 8" />
      <path d="M6 8a6 6 0 0 0 0 8" />
      <path d="M21 5a10 10 0 0 1 0 14" />
      <path d="M3 5a10 10 0 0 0 0 14" />
      <rect x="9" y="5" width="6" height="14" rx="3" />
    </svg>
  );
}

// ── Setting Row Component ───────────────────────────────────────────

interface SettingRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  badge?: string;
}

function SettingRow({ id, label, description, checked, onChange, testId, badge }: SettingRowProps) {
  return (
    <div className="resto-compact-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, paddingRight: 'var(--space-3)' }}>
        <label htmlFor={id} className="resto-compact-label" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <span>{label}</span>
          {badge && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 500,
                color: 'var(--color-warning, #e6a23c)',
                background: 'var(--color-warning-subtle, rgba(230, 162, 60, 0.12))',
                border: '1px solid var(--color-warning-border, rgba(230, 162, 60, 0.3))',
                borderRadius: '4px',
                padding: '1px 6px',
                lineHeight: '1.2',
              }}
            >
              {badge}
            </span>
          )}
        </label>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)', display: 'block', marginTop: '2px' }}>
          {description}
        </span>
      </div>
      <div className="resto-compact-control" style={{ flex: '0 0 auto', paddingTop: '2px' }}>
        <span className="settings-toggle">
          <label className="settings-toggle-switch" htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={checked}
              aria-checked={checked}
              aria-label={label}
              data-testid={testId || `setting-toggle-${id}`}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="settings-toggle-slider" aria-hidden="true" />
          </label>
        </span>
      </div>
    </div>
  );
}

// ── Screen State Interface ──────────────────────────────────────────

interface RestaurantSettingsValues {
  tableNumber: boolean;
  customerName: boolean;
  guestCount: boolean;
  orderTypePrompt: boolean;
  holdOrder: boolean;
  saveTab: boolean;
  courseFiring: boolean;
  autoPrintKitchen: boolean;
  soundChime: boolean;
  interactionSound: boolean;
  interactionVibration: boolean;
}

const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettingsValues = {
  tableNumber: true,
  customerName: true,
  guestCount: false,
  orderTypePrompt: true,
  holdOrder: true,
  saveTab: true,
  courseFiring: false,
  autoPrintKitchen: false,
  soundChime: true,
  interactionSound: true,
  interactionVibration: true,
};

export interface RestaurantSettingsScreenProps {
  onSaved?: () => void;
  onBack?: () => void;
}

export function RestaurantSettingsScreen({ onSaved, onBack }: RestaurantSettingsScreenProps) {
  const { sessionToken } = useWorkspace();
  const settingsContext = useOptionalSettings();
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Settings states
  const [tableNumber, setTableNumber] = useState(DEFAULT_RESTAURANT_SETTINGS.tableNumber);
  const [customerName, setCustomerName] = useState(DEFAULT_RESTAURANT_SETTINGS.customerName);
  const [guestCount, setGuestCount] = useState(DEFAULT_RESTAURANT_SETTINGS.guestCount);
  const [orderTypePrompt, setOrderTypePrompt] = useState(DEFAULT_RESTAURANT_SETTINGS.orderTypePrompt);
  const [holdOrder, setHoldOrder] = useState(DEFAULT_RESTAURANT_SETTINGS.holdOrder);
  const [saveTab, setSaveTab] = useState(DEFAULT_RESTAURANT_SETTINGS.saveTab);
  const [courseFiring, setCourseFiring] = useState(DEFAULT_RESTAURANT_SETTINGS.courseFiring);
  const [autoPrintKitchen, setAutoPrintKitchen] = useState(DEFAULT_RESTAURANT_SETTINGS.autoPrintKitchen);
  const [soundChime, setSoundChime] = useState(DEFAULT_RESTAURANT_SETTINGS.soundChime);
  const [interactionSound, setInteractionSound] = useState(DEFAULT_RESTAURANT_SETTINGS.interactionSound);
  const [interactionVibration, setInteractionVibration] = useState(DEFAULT_RESTAURANT_SETTINGS.interactionVibration);

  // Dirty tracking
  const originalsRef = useRef<RestaurantSettingsValues>({ ...DEFAULT_RESTAURANT_SETTINGS });
  const [dirtyVersion, setDirtyVersion] = useState(0);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      if (!sessionToken) return;
      setLoading(true);
      try {
        const [
          tableNumRaw,
          custNameRaw,
          guestCountRaw,
          orderTypeRaw,
          holdOrderRaw,
          saveTabRaw,
          courseFiringRaw,
          autoPrintRaw,
          soundChimeRaw,
          interactionSoundRaw,
          interactionVibrationRaw,
          receiptSettings,
        ] = await Promise.all([
          getSettingScoped(sessionToken, 'restaurant.table_number').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.customer_name').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.guest_count').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.order_type_prompt').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.hold_order').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.save_tab').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.course_firing').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.auto_print_kitchen').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.sound_chime').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.interaction_sound').catch(() => null),
          getSettingScoped(sessionToken, 'restaurant.interaction_vibration').catch(() => null),
          getReceiptSettingsScoped(sessionToken).catch(() => null),
        ]);

        if (cancelled) return;

        const resolvedTableNum =
          tableNumRaw !== null
            ? tableNumRaw === 'true'
            : receiptSettings?.showTableNumber ?? DEFAULT_RESTAURANT_SETTINGS.tableNumber;
        const resolvedCustName =
          custNameRaw !== null ? custNameRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.customerName;
        const resolvedGuestCount =
          guestCountRaw !== null ? guestCountRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.guestCount;
        const resolvedOrderType =
          orderTypeRaw !== null ? orderTypeRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.orderTypePrompt;
        const resolvedHoldOrder =
          holdOrderRaw !== null ? holdOrderRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.holdOrder;
        const resolvedSaveTab =
          saveTabRaw !== null ? saveTabRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.saveTab;
        const resolvedCourseFiring =
          courseFiringRaw !== null ? courseFiringRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.courseFiring;
        const resolvedAutoPrint =
          autoPrintRaw !== null ? autoPrintRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.autoPrintKitchen;
        const resolvedSoundChime =
          soundChimeRaw !== null ? soundChimeRaw === 'true' : DEFAULT_RESTAURANT_SETTINGS.soundChime;
        const resolvedInteractionSound =
          interactionSoundRaw !== null
            ? interactionSoundRaw === 'true'
            : isInteractionSoundEnabled();
        const resolvedInteractionVibration =
          interactionVibrationRaw !== null
            ? interactionVibrationRaw === 'true'
            : isInteractionVibrationEnabled();

        setTableNumber(resolvedTableNum);
        setCustomerName(resolvedCustName);
        setGuestCount(resolvedGuestCount);
        setOrderTypePrompt(resolvedOrderType);
        setHoldOrder(resolvedHoldOrder);
        setSaveTab(resolvedSaveTab);
        setCourseFiring(resolvedCourseFiring);
        setAutoPrintKitchen(resolvedAutoPrint);
        setSoundChime(resolvedSoundChime);
        setInteractionSound(resolvedInteractionSound);
        setInteractionVibration(resolvedInteractionVibration);

        originalsRef.current = {
          tableNumber: resolvedTableNum,
          customerName: resolvedCustName,
          guestCount: resolvedGuestCount,
          orderTypePrompt: resolvedOrderType,
          holdOrder: resolvedHoldOrder,
          saveTab: resolvedSaveTab,
          courseFiring: resolvedCourseFiring,
          autoPrintKitchen: resolvedAutoPrint,
          soundChime: resolvedSoundChime,
          interactionSound: resolvedInteractionSound,
          interactionVibration: resolvedInteractionVibration,
        };
        setDirtyVersion((v) => v + 1);
      } catch {
        addToastRef.current({
          message: l10nRef.current.getString('restaurant-settings-error-load') || 'Failed to load restaurant settings',
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
  }, [sessionToken]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    const orig = originalsRef.current;
    return (
      tableNumber !== orig.tableNumber ||
      customerName !== orig.customerName ||
      guestCount !== orig.guestCount ||
      orderTypePrompt !== orig.orderTypePrompt ||
      holdOrder !== orig.holdOrder ||
      saveTab !== orig.saveTab ||
      courseFiring !== orig.courseFiring ||
      autoPrintKitchen !== orig.autoPrintKitchen ||
      soundChime !== orig.soundChime ||
      interactionSound !== orig.interactionSound ||
      interactionVibration !== orig.interactionVibration
    );
  }, [
    tableNumber,
    customerName,
    guestCount,
    orderTypePrompt,
    holdOrder,
    saveTab,
    courseFiring,
    autoPrintKitchen,
    soundChime,
    interactionSound,
    interactionVibration,
    dirtyVersion,
  ]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!sessionToken) return;
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // 1. Write restaurant settings keys atomically
      tasks.push(
        setSettingsScoped(sessionToken, {
          'restaurant.table_number': String(tableNumber),
          'restaurant.customer_name': String(customerName),
          'restaurant.guest_count': String(guestCount),
          'restaurant.order_type_prompt': String(orderTypePrompt),
          'restaurant.hold_order': String(holdOrder),
          'restaurant.save_tab': String(saveTab),
          'restaurant.course_firing': String(courseFiring),
          'restaurant.auto_print_kitchen': String(autoPrintKitchen),
          'restaurant.sound_chime': String(soundChime),
          'restaurant.interaction_sound': String(interactionSound),
          'restaurant.interaction_vibration': String(interactionVibration),
        }),
      );

      // 2. Keep local interaction preference in sync immediately
      setInteractionSoundEnabled(interactionSound);
      setInteractionVibrationEnabled(interactionVibration);

      // 3. Keep receiptSettings.showTableNumber in sync
      try {
        const currentReceipt = await getReceiptSettingsScoped(sessionToken);
        if (currentReceipt && currentReceipt.showTableNumber !== tableNumber) {
          tasks.push(
            setReceiptSettingsScoped(sessionToken, {
              ...currentReceipt,
              showTableNumber: tableNumber,
            }),
          );
        }
      } catch {
        // Fallback: receipt read error should not block general settings save
      }

      await Promise.all(tasks);

      originalsRef.current = {
        tableNumber,
        customerName,
        guestCount,
        orderTypePrompt,
        holdOrder,
        saveTab,
        courseFiring,
        autoPrintKitchen,
        soundChime,
        interactionSound,
        interactionVibration,
      };
      setDirtyVersion((v) => v + 1);

      settingsContext?.markSettingsUpdated?.([
        'restaurant.table_number',
        'restaurant.customer_name',
        'restaurant.guest_count',
        'restaurant.order_type_prompt',
        'restaurant.hold_order',
        'restaurant.save_tab',
        'restaurant.course_firing',
        'restaurant.auto_print_kitchen',
        'restaurant.sound_chime',
        'restaurant.interaction_sound',
        'restaurant.interaction_vibration',
        'receipt.showTableNumber',
      ]);

      addToast({
        message: l10n.getString('restaurant-save-success') || 'Settings saved successfully',
        type: 'success',
      });

      onSaved?.();
    } catch {
      addToast({
        message: l10n.getString('restaurant-settings-error-save') || 'Failed to save settings',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [
    sessionToken,
    tableNumber,
    customerName,
    guestCount,
    orderTypePrompt,
    holdOrder,
    saveTab,
    courseFiring,
    autoPrintKitchen,
    soundChime,
    interactionSound,
    interactionVibration,
    settingsContext,
    l10n,
    addToast,
    onSaved,
  ]);

  // Back Navigation Guard with Unsaved Dialog
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

  return (
    <div className="restaurant-settings-screen">
      {/* Header */}
      <div className="restaurant-settings-header" data-testid="restaurant-settings-header">
        <div className="restaurant-settings-header-lead">
          {onBack && (
            <button
              type="button"
              className="restaurant-settings-back-btn"
              onClick={handleRequestBack}
              aria-label={l10n.getString('back') || 'Back'}
              data-testid="restaurant-settings-back-btn"
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
              data-testid="restaurant-settings-icon"
              aria-hidden="true"
            >
              <SettingsIcon />
            </span>
            <Localized id="restaurant-general-settings-title">
              <h1 className="restaurant-settings-title" data-testid="restaurant-settings-title">
                Restaurant Settings
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
              data-testid="restaurant-settings-save-btn"
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

      {/* Main Body */}
      <div className="restaurant-settings-main">
        {loading ? (
          <p className="restaurant-settings-loading">
            <Localized id="settings-section-loading">Loading…</Localized>
          </p>
        ) : (
          <div className="resto-payment-cards-list">

            {/* ── 1. Order Entry & Identification ─────────────────── */}
            <div className="resto-payment-card-wrapper" data-testid="settings-card-order-entry">
              <div className="resto-payment-card resto-payment-card--expanded">
                <div className="restaurant-settings-card-header resto-payment-card-header">
                  <div className="resto-payment-card-title-group">
                    <span className="restaurant-settings-header-icon" aria-hidden="true">
                      <OrderEntryIcon />
                    </span>
                    <span className="resto-payment-card-title">Order Entry & Identification</span>
                  </div>
                </div>
                <div className="resto-payment-card-body">
                  <div className="resto-compact-form">
                    <SettingRow
                      id="resto-setting-table-number"
                      label="Table Number"
                      description="Prompt for table assignment when starting a new dine-in order"
                      checked={tableNumber}
                      onChange={setTableNumber}
                      testId="setting-toggle-table-number"
                    />
                    <SettingRow
                      id="resto-setting-customer-name"
                      label="Customer Name"
                      description="Allow capturing guest or customer name on order tickets and tabs"
                      checked={customerName}
                      onChange={setCustomerName}
                      testId="setting-toggle-customer-name"
                    />
                    <SettingRow
                      id="resto-setting-guest-count"
                      label="Guest Count (Pax)"
                      description="Prompt for party size and number of seated guests per table"
                      checked={guestCount}
                      onChange={setGuestCount}
                      testId="setting-toggle-guest-count"
                    />
                    <SettingRow
                      id="resto-setting-order-type"
                      label="Order Type Selection"
                      description="Require selecting Dine-in, Takeaway, or Delivery before adding items"
                      checked={orderTypePrompt}
                      onChange={setOrderTypePrompt}
                      testId="setting-toggle-order-type"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── 2. Order Workflow & Tabs ────────────────────────── */}
            <div className="resto-payment-card-wrapper" data-testid="settings-card-workflow">
              <div className="resto-payment-card resto-payment-card--expanded">
                <div className="restaurant-settings-card-header resto-payment-card-header">
                  <div className="resto-payment-card-title-group">
                    <span className="restaurant-settings-header-icon" aria-hidden="true">
                      <TabsWorkflowIcon />
                    </span>
                    <span className="resto-payment-card-title">Order Workflow & Tabs</span>
                  </div>
                </div>
                <div className="resto-payment-card-body">
                  <div className="resto-compact-form">
                    <SettingRow
                      id="resto-setting-hold-order"
                      label="Hold Order"
                      description="Allow cashier to park or temporarily hold in-progress orders"
                      checked={holdOrder}
                      onChange={setHoldOrder}
                      testId="setting-toggle-hold-order"
                    />
                    <SettingRow
                      id="resto-setting-save-tab"
                      label="Save Tab / Open Bill"
                      description="Enable running customer tabs and table tabs for deferred settlement"
                      checked={saveTab}
                      onChange={setSaveTab}
                      testId="setting-toggle-save-tab"
                    />
                    <SettingRow
                      id="resto-setting-course-firing"
                      label="Course Firing"
                      description="Enable coursing rules (appetizers, mains, desserts) for kitchen firing"
                      checked={courseFiring}
                      onChange={setCourseFiring}
                      testId="setting-toggle-course-firing"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── 3. Kitchen & Audio Notifications ────────────────── */}
            <div className="resto-payment-card-wrapper" data-testid="settings-card-kitchen">
              <div className="resto-payment-card resto-payment-card--expanded">
                <div className="restaurant-settings-card-header resto-payment-card-header">
                  <div className="resto-payment-card-title-group">
                    <span className="restaurant-settings-header-icon" aria-hidden="true">
                      <KitchenBellIcon />
                    </span>
                    <span className="resto-payment-card-title">Kitchen & Notifications</span>
                  </div>
                </div>
                <div className="resto-payment-card-body">
                  <div className="resto-compact-form">
                    <SettingRow
                      id="resto-setting-auto-print-kitchen"
                      label="Auto-Print Kitchen Ticket (KOT)"
                      description="Automatically send order tickets to kitchen printer upon saving or holding"
                      checked={autoPrintKitchen}
                      onChange={setAutoPrintKitchen}
                      testId="setting-toggle-auto-print-kitchen"
                    />
                    <SettingRow
                      id="resto-setting-sound-chime"
                      label="Order Sound Notifications"
                      description="Play an audible confirmation chime when orders are sent or updated"
                      checked={soundChime}
                      onChange={setSoundChime}
                      testId="setting-toggle-sound-chime"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── 4. Interaction & Feedback ──────────────────────── */}
            <div className="resto-payment-card-wrapper" data-testid="settings-card-interaction">
              <div className="resto-payment-card resto-payment-card--expanded">
                <div className="restaurant-settings-card-header resto-payment-card-header">
                  <div className="resto-payment-card-title-group">
                    <span className="restaurant-settings-header-icon" aria-hidden="true">
                      <InteractionIcon />
                    </span>
                    <span className="resto-payment-card-title">
                      <Localized id="restaurant-settings-interaction-heading">
                        <span>Interaction & Feedback</span>
                      </Localized>
                    </span>
                  </div>
                </div>
                <div className="resto-payment-card-body">
                  <div className="resto-compact-form">
                    <SettingRow
                      id="resto-setting-interaction-sound"
                      label={l10n.getString('restaurant-settings-interaction-sound') || 'Sound Feedback'}
                      description={
                        l10n.getString('restaurant-settings-interaction-sound-desc') ||
                        'Play audio feedback on button taps, cart edits, and checkout'
                      }
                      checked={interactionSound}
                      onChange={setInteractionSound}
                      testId="setting-toggle-interaction-sound"
                    />
                    <SettingRow
                      id="resto-setting-interaction-vibration"
                      label={l10n.getString('restaurant-settings-interaction-vibration') || 'Haptic Vibration'}
                      description={
                        l10n.getString('restaurant-settings-interaction-vibration-desc') ||
                        'Device vibration on taps (supported on Android/tablet only; not available on Windows, Linux, or macOS)'
                      }
                      badge="Mobile/Tablet only (not on Win/Linux/Mac)"
                      checked={interactionVibration}
                      onChange={setInteractionVibration}
                      testId="setting-toggle-interaction-vibration"
                    />
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

export default RestaurantSettingsScreen;
