/**
 * RegionalSettingsCard — the regional-configuration card for the
 * Settings → Business Defaults screen (regional slice 3, saas-2 design).
 *
 * Binds to the session's PRIMARY location (open question 3: single-entity
 * tenants are normal — no per-entity picker prerequisite; the topology
 * inspector owns per-location editing). Shows the effective locale/
 * timezone/currency/country for that location with per-axis provenance,
 * and writes the location layer through `set_regional_config_scoped`
 * (settings:edit server-side). All validation lives in core — the card
 * never re-implements the ADR #48 timezone contract or the ISO shapes.
 *
 * Fluent-only copy: `settings-regional-*` keys in settings.ftl +
 * settings.id.ftl. Error copy comes from the shared app-error map with
 * `settings-regional-error-*` fallbacks.
 */
import { useCallback, useEffect, useState } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import SettingsSelect, { type SettingsSelectOption } from '@/features/settings/SettingsSelect';
import { SettingsScopeTag } from '@/features/settings/SettingsScopeTag';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  getRegionalConfigScoped,
  setRegionalConfigScoped,
  REGIONAL_TIMEZONE_PRESETS,
  type RegionalConfig,
  type RegionalScope,
  type SetRegionalConfigArgs,
} from '@/api/regional';
import { getPrimaryLocationScoped } from '@/api/locations';
import { listCurrenciesScoped, type CurrencyDto } from '@/api/currency';
import { l10nErrorMessage } from '@/utils/app-error';
import './RegionalSettingsCard.css';

/** The provenance row shown under each field: effective value + who answered. */
function provenanceKey(scope: RegionalScope): string {
  switch (scope) {
    case 'location':
      return 'settings-regional-scope-location';
    case 'legal_entity':
      return 'settings-regional-scope-legal-entity';
    case 'organization':
      return 'settings-regional-scope-organization';
    case 'built_in':
      return 'settings-regional-scope-built-in';
  }
}

/** Blank means inherit — the location layer's stored value, not the effective one. */
function storedLocationValue(config: RegionalConfig, axis: 'locale' | 'timezone' | 'currency'): string {
  return config[axis].scope === 'location' ? config[axis].value : '';
}

/**
 * Regional defaults card. Reads the primary location + its resolved config,
 * lets the operator set the location layer, and re-renders provenance from
 * the write's read-after-write response.
 */
export function RegionalSettingsCard() {
  const { sessionToken } = useWorkspace();
  const { l10n } = useLocalization();

  const [config, setConfig] = useState<RegionalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [locale, setLocale] = useState('');
  const [timezone, setTimezone] = useState('');
  const [currency, setCurrency] = useState('');
  const [countryCode, setCountryCode] = useState('');

  const [currencies, setCurrencies] = useState<CurrencyDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(
    async (token: string) => {
      setLoading(true);
      setLoadError(null);
      try {
        const primary = await getPrimaryLocationScoped(token);
        if (!primary) {
          setConfig(null);
          setLoading(false);
          return;
        }
        const resolved = await getRegionalConfigScoped(token, primary.id);
        setConfig(resolved);
        setLocale(storedLocationValue(resolved, 'locale'));
        setTimezone(storedLocationValue(resolved, 'timezone'));
        setCurrency(storedLocationValue(resolved, 'currency'));
        setCountryCode(resolved.country_code ?? '');
        setSaved(false);
      } catch (err) {
        setLoadError(l10nErrorMessage(err, l10n, 'settings-regional-error-load'));
      } finally {
        setLoading(false);
      }
    },
    [l10n],
  );

  useEffect(() => {
    if (!sessionToken) return;
    void load(sessionToken);
  }, [sessionToken, load]);

  useEffect(() => {
    if (!sessionToken) return;
    listCurrenciesScoped(sessionToken)
      .then((list) => setCurrencies(list))
      .catch(() => {
        /* the currency field degrades to free text — not worth a banner */
      });
  }, [sessionToken]);

  const handleSave = useCallback(async () => {
    if (!sessionToken || !config) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const draft: SetRegionalConfigArgs = {
      locale,
      timezone,
      currency,
      country_code: countryCode,
    };
    try {
      const updated = await setRegionalConfigScoped(sessionToken, config.location_id, draft);
      setConfig(updated);
      setLocale(storedLocationValue(updated, 'locale'));
      setTimezone(storedLocationValue(updated, 'timezone'));
      setCurrency(storedLocationValue(updated, 'currency'));
      setCountryCode(updated.country_code ?? '');
      setSaved(true);
    } catch (err) {
      setSaveError(l10nErrorMessage(err, l10n, 'settings-regional-error-save'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, config, locale, timezone, currency, countryCode, l10n]);

  // Non-preset stored values can only come from pre-ADR-#48 rows; they are
  // shown so the select never silently rewrites them on save, but the
  // backend rejects re-selecting them — the option is labeled as legacy.
  const timezoneOptions: SettingsSelectOption[] = [
    { value: '', label: l10n.getString('settings-regional-timezone-inherit') || 'Inherit (scope above)' },
    ...REGIONAL_TIMEZONE_PRESETS.map((tz) => ({ value: tz, label: tz })),
    { value: 'UTC', label: l10n.getString('settings-regional-timezone-utc') || 'UTC (legacy sentinel)' },
    ...(timezone && !REGIONAL_TIMEZONE_PRESETS.includes(timezone) && timezone !== 'UTC'
      ? [{ value: timezone, label: `${timezone} — ${l10n.getString('settings-regional-timezone-legacy') || 'legacy value'}` }]
      : []),
  ];

  const currencyOptions: SettingsSelectOption[] = [
    { value: '', label: l10n.getString('settings-regional-currency-inherit') || 'Inherit (scope above)' },
    ...currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
  ];

  if (loading) {
    return (
      <Card shadow="sm">
        <p className="regional-settings-loading">
          <Localized id="settings-section-loading">Loading…</Localized>
        </p>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm">
        <p className="regional-settings-error" role="alert">
          {loadError}
        </p>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card shadow="sm">
        <p className="regional-settings-empty">
          <Localized id="settings-regional-no-location">No location to configure yet.</Localized>
        </p>
      </Card>
    );
  }

  return (
    <Card
      shadow="sm"
      header={
        <div className="regional-settings-header">
          <Localized id="settings-regional-title">
            <h2 className="settings-section-title">Regional</h2>
          </Localized>
          <SettingsScopeTag scope="location" />
        </div>
      }
    >
      <p className="regional-settings-intro">
        <Localized id="settings-regional-subtitle">
          Market facts this location answers for receipts and reports. Blank
          fields inherit from the legal entity or the organization defaults.
        </Localized>
      </p>
      <div className="regional-settings-grid">
        <div className="regional-settings-field">
          <label htmlFor="regional-locale-input">
            <Localized id="settings-regional-locale">Locale (BCP-47)</Localized>
          </label>
          <input
            id="regional-locale-input"
            type="text"
            value={locale}
            onChange={(e) => { setLocale(e.target.value); setSaved(false); }}
            placeholder={l10n.getString('settings-regional-locale-placeholder') || 'e.g. id-ID — blank inherits'}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="regional-settings-provenance">
            <Localized id={provenanceKey(config.locale.scope)}>
              {config.locale.scope}
            </Localized>
          </p>
        </div>

        <div className="regional-settings-field">
          <label htmlFor="regional-timezone-select">
            <Localized id="settings-regional-timezone">Timezone</Localized>
          </label>
          <SettingsSelect
            id="regional-timezone-select"
            value={timezone}
            onChange={(v) => { setTimezone(v); setSaved(false); }}
            options={timezoneOptions}
            ariaLabel={l10n.getString('settings-regional-timezone') || 'Timezone'}
          />
          <p className="regional-settings-provenance">
            <Localized id={provenanceKey(config.timezone.scope)}>
              {config.timezone.scope}
            </Localized>
          </p>
        </div>

        <div className="regional-settings-field">
          <label htmlFor="regional-currency-select">
            <Localized id="settings-regional-currency">Currency (ISO-4217)</Localized>
          </label>
          <SettingsSelect
            id="regional-currency-select"
            value={currency}
            onChange={(v) => { setCurrency(v); setSaved(false); }}
            options={currencyOptions}
            ariaLabel={l10n.getString('settings-regional-currency') || 'Currency'}
            placeholder={l10n.getString('settings-regional-currency-placeholder') || 'e.g. IDR — blank inherits'}
          />
          <p className="regional-settings-provenance">
            <Localized id={provenanceKey(config.currency.scope)}>
              {config.currency.scope}
            </Localized>
          </p>
        </div>

        <div className="regional-settings-field">
          <label htmlFor="regional-country-input">
            <Localized id="settings-regional-country">Market anchor (ISO-3166)</Localized>
          </label>
          <input
            id="regional-country-input"
            type="text"
            value={countryCode}
            onChange={(e) => { setCountryCode(e.target.value); setSaved(false); }}
            placeholder={l10n.getString('settings-regional-country-placeholder') || 'e.g. ID — blank leaves the entity unchanged'}
            autoComplete="off"
            spellCheck={false}
            maxLength={2}
          />
          <p className="regional-settings-hint">
            <Localized id="settings-regional-country-hint">
              Resolved through the location&apos;s legal entity.
            </Localized>
          </p>
        </div>
      </div>

      <div className="regional-settings-actions">
        <button
          type="button"
          className="regional-settings-save"
          onClick={() => { void handleSave(); }}
          disabled={saving}
        >
          {saving ? (
            <Localized id="settings-regional-saving">Saving…</Localized>
          ) : (
            <Localized id="settings-regional-save">Save regional defaults</Localized>
          )}
        </button>
        {saved && (
          <span className="regional-settings-status" role="status">
            <Localized id="settings-regional-saved">Regional defaults saved.</Localized>
          </span>
        )}
        {saveError && (
          <span className="regional-settings-error" role="alert">
            {saveError}
          </span>
        )}
      </div>
    </Card>
  );
}