/**
 * CreditFacilityCard — the store-credit card for the Settings → Business
 * Defaults screen.
 *
 * WHY THIS EXISTS (F24, measured round 62, fixed here).
 *
 * The whole `credit.*` family was built and reached NOTHING. Measured at HEAD
 * before this file existed:
 *
 * | Link | State |
 * |---|---|
 * | Keys `credit.enabled` / `.max_limit` / `.reminder_interval` | exist (settings/keys.rs:165,167,169) |
 * | Typed getters + setters | exist (settings/typed.rs:283,293,308) |
 * | Bridge `get_credit_settings(_scoped)` | registered, both shells |
 * | Bridge `set_credit_settings_scoped` | registered, writes all three in ONE transaction |
 * | UI API `getCreditSettingsScoped` / `setCreditSettingsScoped` | BOTH already existed (api/settings.ts:85,89) |
 * | A screen calling either | **none — this is the first** |
 *
 * So the chain was complete except for the surface, which is why a reader could
 * find `credit` wiring, assume the family was wired, and be wrong. The retail
 * POS DOES use the family's REPORTING side (`listCreditSalesScoped` +
 * `settleCreditScoped`), which is what made the gap invisible.
 *
 * WHAT THIS CARD CLOSES, AND WHAT IT DOES NOT — read this before assuming the
 * credit limit is real:
 *
 *   CLOSES — "no UI reads them". The enable switch, the ceiling and the reminder
 *   interval are now settable and readable. The values persist.
 *
 *   DOES NOT CLOSE — "enforced nowhere". NOTHING consumes these values at sale
 *   time. `is_credit_enabled` is still called only by the getter that returns
 *   it, and `get_credit_max_limit` likewise, so a ceiling set here is
 *   **advisory**: the charge modal offers the `credit` tender unconditionally
 *   (gated only on a customer name, PaymentModal.tsx:1066) and will complete a
 *   credit sale that exceeds this number.
 *
 *   That is a deliberate stop, not an oversight. Enforcing the limit changes
 *   checkout from *succeeds* to *refused*, which needs a decided refusal UX
 *   (what the cashier sees, whether there is an override, who may authorise it).
 *   Wiring it without one means either no real change or a refusal with no
 *   explanation — worse than today. The hint text below says so in the
 *   operator's own words rather than leaving them to discover it.
 *
 * Money is integer minor units throughout: the input is parsed with the shared
 * BigInt-exact `parseMinorUnits` and rendered with `minorUnitsToInputString`,
 * so no amount ever passes through a binary float (MONEY-02).
 *
 * Fluent-only copy: `settings-credit-*` keys in settings.ftl + settings.id.ftl.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { SettingsScopeTag } from '@/features/settings/SettingsScopeTag';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getCreditSettingsScoped, setCreditSettingsScoped } from '@/api/settings';
import { getDefaultCurrencyScoped } from '@/api/currency';
import { minorUnitExponent, parseMinorUnits } from '@/types/domain';
import { minorUnitsToInputString } from '@/features/sales/payment/moneyFormat';
import { l10nErrorMessage } from '@/utils/app-error';
import './CreditFacilityCard.css';

export function CreditFacilityCard() {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [reminderHours, setReminderHours] = useState('0');
  /** The ceiling as the operator typed it. Parsed on save, never on change. */
  const [limitInput, setLimitInput] = useState('0');
  const [currency, setCurrency] = useState('IDR');

  const exp = minorUnitExponent(currency);

  // The exponent depends on the store currency, so it is read rather than
  // assumed. A wrong exponent scales every ceiling by 10^n, and the failure
  // looks like "the limit I typed is not the limit stored".
  useEffect(() => {
    if (!sessionToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const code = await getDefaultCurrencyScoped(sessionToken);
        if (!cancelled && code) setCurrency(code);
      } catch {
        // A failed currency read is not fatal: the card still renders and the
        // exponent falls back to the 2-decimal default. Recorded rather than
        // silently swallowed so a later reader knows the branch is reachable.
      }
    })();
    return () => { cancelled = true; };
  }, [sessionToken]);

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const settings = await getCreditSettingsScoped(token);
        setEnabled(settings.enabled);
        setReminderHours(String(settings.reminderIntervalHours));
        setLimitInput(minorUnitsToInputString(settings.maxLimitMinor, minorUnitExponent(currency)));
        setSaved(false);
      } catch (err) {
        setLoadError(l10nErrorMessage(err, l10n, 'settings-credit-error-load'));
      } finally {
        setLoading(false);
      }
    },
    [l10n, currency],
  );

  useEffect(() => {
    if (!sessionToken) return;
    void load(sessionToken);
  }, [sessionToken, load]);

  const handleSave = useCallback(async () => {
    if (!sessionToken) return;
    // `parseMinorUnits` returns null for anything that is not a plain decimal
    // literal, and null must NEVER become zero — a typo would silently remove
    // the ceiling. Refuse the save instead.
    const parsedLimit = parseMinorUnits(limitInput, exp);
    if (parsedLimit === null || parsedLimit < 0) {
      setSaveError(l10n.getString('settings-credit-error-limit') || 'Enter a valid limit amount.');
      return;
    }
    const parsedReminder = parseMinorUnits(reminderHours, 0);
    if (parsedReminder === null || parsedReminder < 0) {
      setSaveError(l10n.getString('settings-credit-error-reminder') || 'Enter a valid reminder interval.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // All three keys in one call: the bridge writes them in a single
      // transaction, so a partial save cannot land.
      await setCreditSettingsScoped(sessionToken, {
        enabled,
        reminderIntervalHours: parsedReminder,
        maxLimitMinor: parsedLimit,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(l10nErrorMessage(err, l10n, 'settings-credit-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, enabled, reminderHours, limitInput, exp, l10n]);

  if (loading) {
    return (
      <Card shadow="sm">
        <p className="credit-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm">
        <p className="credit-error" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  return (
    <Card
      shadow="sm"
      header={
        <div className="credit-header">
          <Localized id="settings-credit-title">
            <h2 className="settings-section-title">Store credit</h2>
          </Localized>
          {/* `workspace`, not `location`: the credit keys are read and written
              through `open_store(&session.store_id)` (bridge settings.rs:188/:213),
              which is the store database — the workspace level in this
              vocabulary. Labelling it "location" would put it beside the payment
              rails, which genuinely are location-scoped and provenanced. */}
          <SettingsScopeTag scope="workspace" />
        </div>
      }
    >
      <p className="credit-intro">
        <Localized id="settings-credit-subtitle">
          <span>Whether this store offers credit, and on what terms.</span>
        </Localized>
      </p>

      <label className="credit-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }}
          /* The visible text is inside <Localized>, so its content is opaque to
             jsx-a11y/label-has-associated-control — the rule cannot see a string
             to associate. An explicit aria-label satisfies it honestly rather
             than by suppressing it, and gives the control a stable accessible
             name regardless of locale. */
          aria-label={l10n.getString('settings-credit-enabled') || 'Offer credit sales'}
        />
        <span className="credit-label">
          <Localized id="settings-credit-enabled">
            <span>Offer credit sales</span>
          </Localized>
        </span>
      </label>

      <div className="credit-fields">
        <label className="credit-field">
          <span className="credit-field-label">
            <Localized id="settings-credit-limit-label">
              <span>Credit ceiling</span>
            </Localized>
          </span>
          <input
            type="text"
            inputMode="decimal"
            className="credit-input"
            value={limitInput}
            onChange={(e) => { setLimitInput(e.target.value); setSaved(false); }}
            aria-label={l10n.getString('settings-credit-limit-label') || 'Credit ceiling'}
            autoComplete="off"
          />
        </label>

        <label className="credit-field">
          <span className="credit-field-label">
            <Localized id="settings-credit-reminder-label">
              <span>Reminder interval (hours)</span>
            </Localized>
          </span>
          <input
            type="text"
            inputMode="numeric"
            className="credit-input"
            value={reminderHours}
            onChange={(e) => { setReminderHours(e.target.value); setSaved(false); }}
            aria-label={l10n.getString('settings-credit-reminder-label') || 'Reminder interval (hours)'}
            autoComplete="off"
          />
        </label>
      </div>

      <p className="credit-hint">
        <Localized id="settings-credit-advisory">
          <span>
            This ceiling is recorded for your reference. Sales above it are not blocked yet.
          </span>
        </Localized>
      </p>

      <div className="credit-actions">
        <button
          type="button"
          className="credit-save"
          onClick={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <Localized id="settings-credit-saving">Saving…</Localized>
          ) : (
            <Localized id="settings-credit-save">Save credit settings</Localized>
          )}
        </button>
        {saved && (
          <span className="credit-status" role="status">
            <Localized id="settings-credit-saved">Credit settings saved.</Localized>
          </span>
        )}
        {saveError && (
          <span className="credit-error" role="alert">
            {saveError}
          </span>
        )}
      </div>
    </Card>
  );
}
