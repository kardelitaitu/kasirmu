// ── Restaurant POS settings — the sidebar's full-screen Settings screen ──
//
// OWNERSHIP OF EACH TOGGLE'S KEY (P1 of todo-restaurant-pos-reliability.md).
// This screen is one of THREE surfaces that write restaurant settings — the
// F10 WorkspaceRestaurantPosSettings card and RestaurantReceiptsScreen are the
// others — so which key each control owns is stated here rather than inferred:
//
//   restaurant.customer_name        owned here; gates the cart's customer field
//   restaurant.guest_count          owned here; gates the cart's pax field
//   restaurant.order_type_prompt    owned here; read by PosScreen (order-type effect)
//   restaurant.hold_order           owned here
//   restaurant.save_tab             owned here
//   restaurant.course_firing        SHARED with the F10 card (both write it)
//   restaurant.auto_print_kitchen   owned here
//   restaurant.sound_chime          owned here
//   restaurant.interaction_sound    owned here; mirrored to localStorage
//   restaurant.interaction_vibration owned here; mirrored to localStorage
//
// TABLE CAPTURE IS NOT A TOGGLE HERE, deliberately. The cart's table input is
// part of what a restaurant POS IS, so it renders unconditionally
// (`CartPanel.tsx:655`) and the only table-number control is the PRINT toggle in
// RestaurantReceiptsScreen (`receipt.showTableNumber`, `:1889`). This screen used
// to render a second toggle writing `restaurant.table_number`, a key with NO
// reader anywhere: it persisted and reloaded faithfully while changing nothing.
// It was removed rather than wired because the value the POS reads
// (`receipt.show_table_number`) lives in the STORE database while provisioning
// writes the GLOBAL one, so a restaurant default for it is not expressible as a
// provisioning fact — see finding F14 in the plan doc.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useOptionalSettings } from '@/contexts/SettingsContext';
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { getSettingScoped, setSettingsScoped } from '@/api/settings';
import {
  isInteractionSoundEnabled,
  isInteractionVibrationEnabled,
  setInteractionSoundEnabled,
  setInteractionVibrationEnabled,
} from '@/utils/interaction';
import {
  DEFAULT_RESTAURANT_SETTINGS,
  loadRestaurantSettings,
  type RestaurantSettingsValues,
} from './restaurantSettingsModel';
import './RestaurantSettingsScreens.css';

// ── Settings Icon ───────────────────────────────────────────────────

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
//
// `RestaurantSettingsValues` and `DEFAULT_RESTAURANT_SETTINGS` now live in
// ./settingsModel so the load logic that applies them is unit-testable without a
// DOM, and so there is exactly ONE copy of each default.

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

  // True when a key's read FAILED (as opposed to returning null = never written).
  //
  // This is the F4 fix, and it is a data-loss guard rather than polish. Every key
  // below used to be loaded with `.catch(() => null)`, which made a transport
  // failure indistinguishable from "never written": the resolver fell back to
  // DEFAULT_RESTAURANT_SETTINGS and then seeded `originalsRef` from those
  // defaults, so `dirty` read false and the screen looked clean and saved. The
  // merchant's next Save then wrote the DEFAULTS over their real configuration.
  //
  // With this flag the screen refuses to present a loaded state it cannot vouch
  // for: no Save, an explicit error, and a retry that re-reads.
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by Retry to re-run the load effect.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      if (!sessionToken) return;
      setLoading(true);
      try {
        // Every read goes through the model, which keeps "never written" (null,
        // serve the default) apart from "could not read" (reject, refuse to
        // pretend). See settingsModel.ts for why that distinction is a data-loss
        // guard and not a nicety.
        const result = await loadRestaurantSettings(
          sessionToken,
          getSettingScoped,
          {
            interactionSound: isInteractionSoundEnabled(),
            interactionVibration: isInteractionVibrationEnabled(),
          },
        );

        if (cancelled) return;

        // Refuse to present a loaded state we cannot vouch for: no values are
        // seeded, so `originalsRef` keeps its previous contents, `dirty` cannot
        // read a false "clean", and the Save button stays disabled (see the
        // header render). Seeding defaults here is precisely the F4 bug.
        if (!result.ok) {
          setLoadFailed(true);
          return;
        }
        setLoadFailed(false);
        const values = result.values;

        setCustomerName(values.customerName);
        setGuestCount(values.guestCount);
        setOrderTypePrompt(values.orderTypePrompt);
        setHoldOrder(values.holdOrder);
        setSaveTab(values.saveTab);
        setCourseFiring(values.courseFiring);
        setAutoPrintKitchen(values.autoPrintKitchen);
        setSoundChime(values.soundChime);
        setInteractionSound(values.interactionSound);
        setInteractionVibration(values.interactionVibration);

        // F6 / D3 — the DB is authoritative, and the RUNTIME reads localStorage.
        //
        // `utils/interaction.ts` decides whether to play a sound or vibrate by
        // reading `pos.interaction_sound` / `pos.interaction_vibration` from
        // localStorage. The DB keys above are what actually sync across devices,
        // so without this write-through a fresh device, a cleared webview cache,
        // or a second terminal keeps the localStorage default (true) and ignores
        // the saved preference entirely. The save path already writes these two;
        // this closes the same gap on the load path.
        //
        // Idempotent when the key was unset: the value came FROM localStorage, so
        // writing it back changes nothing.
        setInteractionSoundEnabled(values.interactionSound);
        setInteractionVibrationEnabled(values.interactionVibration);

        originalsRef.current = { ...values };
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
    // `reloadNonce` is the Retry control's re-run trigger.
  }, [sessionToken, reloadNonce]);

  const dirty = useMemo(() => {
    void dirtyVersion;
    const orig = originalsRef.current;
    return (
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

      await Promise.all(tasks);

      // 2. Mirror the interaction preferences to localStorage — AFTER the DB
      //    write, not before (P3/F5).
      //
      //    This used to run before `await`, so a rejected save left localStorage
      //    saying "sound off" while the DB still said "sound on": the device and
      //    the store disagreed, and the runtime believes localStorage. Doing it
      //    after the await means a failed save leaves the local mirror exactly as
      //    it was, matching the DB it failed to change.
      setInteractionSoundEnabled(interactionSound);
      setInteractionVibrationEnabled(interactionVibration);

      originalsRef.current = {
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
              {/* A failed load must not claim "All changes saved". The values on
                  screen are the model's defaults, not the merchant's, so the
                  honest answer is the error banner below and nothing here. */}
              {loadFailed ? null : dirty ? (
                <Localized id="restaurant-unsaved-changes">Unsaved changes</Localized>
              ) : (
                <Localized id="restaurant-all-saved">All changes saved</Localized>
              )}
            </span>
            {/* `loadFailed` disables Save outright. The screen is showing values it
                could not read, so letting it write would overwrite the real ones
                with defaults — the F4 loss. Retry is the only way forward. */}
            <button
              type="button"
              className={`btn btn--primary btn--md resto-anim-btn ${saving ? 'resto-anim-btn--loading' : ''}`}
              disabled={!dirty || saving || loadFailed}
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
          <div className="resto-settings-cards-list">

            {/* ── Load failure (F4) ─────────────────────────────────
                Shown INSTEAD of trusting the controls. The values below are the
                model's defaults, not the merchant's, so the banner says the read
                failed and Retry re-runs it. Save is disabled above. */}
            {loadFailed && (
              <div className="settings-error-banner" role="alert" data-testid="restaurant-settings-load-error">
                <span>
                  <Localized id="restaurant-settings-error-load">
                    <span>Failed to load restaurant settings</span>
                  </Localized>
                </span>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  data-testid="restaurant-settings-retry-btn"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  <Localized id="retry">
                    <span>Retry</span>
                  </Localized>
                </button>
              </div>
            )}

            {/* ── 1. Order Entry & Identification ─────────────────── */}
            <div className="resto-settings-group-card" data-testid="settings-card-order-entry">
              <div className="resto-compact-form">
                <SettingRow
                  id="resto-setting-customer-name"
                  label={l10n.getString('restaurant-setting-customer-name')}
                  description={l10n.getString('restaurant-setting-customer-name-desc')}
                  checked={customerName}
                  onChange={setCustomerName}
                  testId="setting-toggle-customer-name"
                />
                <SettingRow
                  id="resto-setting-guest-count"
                  label={l10n.getString('restaurant-setting-guest-count')}
                  description={l10n.getString('restaurant-setting-guest-count-desc')}
                  checked={guestCount}
                  onChange={setGuestCount}
                  testId="setting-toggle-guest-count"
                />
                <SettingRow
                  id="resto-setting-order-type"
                  label={l10n.getString('restaurant-setting-order-type')}
                  description={l10n.getString('restaurant-setting-order-type-desc')}
                  checked={orderTypePrompt}
                  onChange={setOrderTypePrompt}
                  testId="setting-toggle-order-type"
                />
              </div>
            </div>

            {/* ── 2. Order Workflow & Tabs ────────────────────────── */}
            <div className="resto-settings-group-card" data-testid="settings-card-workflow">
              <div className="resto-compact-form">
                <SettingRow
                  id="resto-setting-hold-order"
                  label={l10n.getString('restaurant-setting-hold-order')}
                  description={l10n.getString('restaurant-setting-hold-order-desc')}
                  checked={holdOrder}
                  onChange={setHoldOrder}
                  testId="setting-toggle-hold-order"
                />
                <SettingRow
                  id="resto-setting-save-tab"
                  label={l10n.getString('restaurant-setting-save-tab')}
                  description={l10n.getString('restaurant-setting-save-tab-desc')}
                  checked={saveTab}
                  onChange={setSaveTab}
                  testId="setting-toggle-save-tab"
                />
                <SettingRow
                  id="resto-setting-course-firing"
                  label={l10n.getString('restaurant-setting-course-firing')}
                  description={l10n.getString('restaurant-setting-course-firing-desc')}
                  checked={courseFiring}
                  onChange={setCourseFiring}
                  testId="setting-toggle-course-firing"
                />
              </div>
            </div>

            {/* ── 3. Kitchen & Audio Notifications ────────────────── */}
            <div className="resto-settings-group-card" data-testid="settings-card-kitchen">
              <div className="resto-compact-form">
                <SettingRow
                  id="resto-setting-auto-print-kitchen"
                  label={l10n.getString('restaurant-setting-auto-print')}
                  description={l10n.getString('restaurant-setting-auto-print-desc')}
                  checked={autoPrintKitchen}
                  onChange={setAutoPrintKitchen}
                  testId="setting-toggle-auto-print-kitchen"
                />
                <SettingRow
                  id="resto-setting-sound-chime"
                  label={l10n.getString('restaurant-setting-sound-chime')}
                  description={l10n.getString('restaurant-setting-sound-chime-desc')}
                  checked={soundChime}
                  onChange={setSoundChime}
                  testId="setting-toggle-sound-chime"
                />
              </div>
            </div>

            {/* ── 4. Interaction & Feedback ──────────────────────── */}
            <div className="resto-settings-group-card" data-testid="settings-card-interaction">
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
                  badge={l10n.getString('restaurant-setting-vibration-badge')}
                  checked={interactionVibration}
                  onChange={setInteractionVibration}
                  testId="setting-toggle-interaction-vibration"
                />
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
