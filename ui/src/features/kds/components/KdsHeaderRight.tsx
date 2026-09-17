/**
 * KdsHeaderRight — the right column of the KDS header: the shift start/stop
 *   button, the device status indicator, and the hamburger settings panel.
 *
 * Extracted verbatim from KdsScreen.tsx:519-566 by the KDS merged-lane
 * header-right slice (the region the plan's region table still lists as the
 * unextracted "header RIGHT"). The moved block is byte-identical except that
 * its reads became props — including `prefs`, passed whole so the three
 * `prefs.*` reads inside needed no retyping.
 *
 * PRESENTATIONAL ONLY — it owns no state and calls no api. The pieces of
 * machinery it touches stay in the screen, deliberately:
 *   - `setConfirm` IS the screen's confirm-dialog state setter (`confirm` at
 *     KdsScreen.tsx:99). "End Shift" asks for confirmation; the dialog markup
 *     itself stays in the screen, which is why the setter is passed in.
 *   - `setInShift` / `setSettings` / `setShowEnrollment` are the screen's
 *     setters, passed through under their own names (the KdsHeaderLeft
 *     convention) so no closure body had to be rewritten.
 *   - The three threshold clamps are imported here from `kdsThresholdMinutes`
 *     — pure helpers, no state — so the onChangeYellow/Red closures move
 *     verbatim with the markup.
 * `KdsDeviceStatusIndicator` and `KdsHamburgerPanel` are children, not moved
 * code; both are registered in the same SCREENS entry already.
 *
 * REGISTERED in __tests__/screenExtraction.test.ts under the KdsScreen entry's
 * additionalTsx. The classes used here — kds-header-right, kds-btn,
 * kds-btn--shift, kds-btn--stack and the `visible` / `is-active` modifiers —
 * are still styled by kds/KdsScreen.css, which that entry already lists;
 * without the registration the reachability guard would read them as dead CSS
 * and stay green, which is the silent failure mode the rule exists to stop.
 */
import { Localized, useLocalization } from '@fluent/react';
import type { Dispatch, SetStateAction } from 'react';
import { requiredLocalized } from '@/components';
import type { KdsPreferences } from '@/features/kds/hooks/useKdsPreferences';
import type { KdsSettings } from '@/features/kds/kdsSettingsModel';
import { clampYellowThreshold, clampRedThreshold, clampYellowFollowingRed } from '@/features/kds/kdsThresholdMinutes';
import { KdsHamburgerPanel } from '@/features/kds/KdsHamburgerPanel';
import { KdsDeviceStatusIndicator } from '@/features/kds/components/KdsDeviceStatusIndicator';

/** The screen's confirm-dialog request shape (`confirm` state in KdsScreen). */
interface KdsConfirmRequest {
  title: string;
  message: string;
  onOk: () => void;
  danger?: boolean;
}

export interface KdsHeaderRightProps {
  /** Whether the kitchen shift is currently open. */
  inShift: boolean;
  /** The screen's shift setter — "End Shift" clears it from the confirm dialog. */
  setInShift: Dispatch<SetStateAction<boolean>>;
  /** The screen's confirm-dialog setter; the dialog markup stays in the screen. */
  setConfirm: Dispatch<SetStateAction<KdsConfirmRequest | null>>;
  /** Session token for the device indicator's scoped status poll. */
  sessionToken: string;
  /** Opens the screen's KdsEnrollmentModal. */
  setShowEnrollment: Dispatch<SetStateAction<boolean>>;
  /** Per-user prefs, read for autoAcknowledge / showOrderId / showTableNumber. */
  prefs: KdsPreferences;
  /** While prefs are still loading the hamburger panel is not rendered at all. */
  prefsLoading: boolean;
  /** Display settings (sound, SLA minutes, density) edited by the panel. */
  settings: KdsSettings;
  setSettings: Dispatch<SetStateAction<KdsSettings>>;
  setAutoAcknowledge: (enabled: boolean) => void;
  setShowOrderId: (show: boolean) => void;
  setShowTableNumber: (show: boolean) => void;
  cardAnimations: boolean;
  setCardAnimations: Dispatch<SetStateAction<boolean>>;
}

export function KdsHeaderRight({
  inShift,
  setInShift,
  setConfirm,
  sessionToken,
  setShowEnrollment,
  prefs,
  prefsLoading,
  settings,
  setSettings,
  setAutoAcknowledge,
  setShowOrderId,
  setShowTableNumber,
  cardAnimations,
  setCardAnimations,
}: KdsHeaderRightProps) {
  const { l10n } = useLocalization();

  return (
        <div className="kds-header-right">
          {/* Shift start/stop button — prototype .kds-btn--shift .kds-btn--stack */}
          <button
            className={`kds-btn kds-btn--shift kds-btn--stack${inShift ? ' is-active' : ''}`}
            onClick={() => {
              if (inShift) {
                setConfirm({
                  title: requiredLocalized(l10n, 'kds-shift-end-title'),
                  message: requiredLocalized(l10n, 'kds-shift-end-msg'),
                  onOk: () => setInShift(false),
                  danger: true,
                });
              } else {
                setInShift(true);
              }
            }}
            data-testid="kds-topbar-shift"
          >
            <span className={!inShift ? 'visible' : ''}><Localized id="kds-shift-start">Start Shift</Localized></span>
            <span className={inShift ? 'visible' : ''}><Localized id="kds-shift-end">End Shift</Localized></span>
          </button>
          {/* Device status indicator */}
          <KdsDeviceStatusIndicator sessionToken={sessionToken} onEnrollDevice={() => setShowEnrollment(true)} />
          {/* Hamburger settings panel — only when prefs loaded */}
          {!prefsLoading && (
            <KdsHamburgerPanel
              settings={{ ...settings, autoAcknowledge: prefs.autoAcknowledge }}
              onChangeSound={(v) => setSettings((s) => ({ ...s, soundEnabled: v }))}
              onChangeYellowThreshold={(v) => setSettings((s) => ({
                ...s,
                yellowThresholdMin: clampYellowThreshold(v, s.redThresholdMin),
              }))}
              onChangeRedThreshold={(v) => setSettings((s) => ({
                ...s,
                redThresholdMin: clampRedThreshold(v),
                yellowThresholdMin: clampYellowFollowingRed(s.yellowThresholdMin, clampRedThreshold(v)),
              }))}
              onChangeAutoAcknowledge={(v) => setAutoAcknowledge(v)}
              onChangeDensity={(v) => setSettings((s) => ({ ...s, density: v }))}
              showOrderId={prefs.showOrderId}
              showTableNumber={prefs.showTableNumber}
              onToggleOrderId={setShowOrderId}
              onToggleTableNumber={setShowTableNumber}
              cardAnimations={cardAnimations}
              onChangeCardAnimations={setCardAnimations}
            />
          )}
        </div>
  );
}
