/**
 * Email Report Settings — SMTP configuration and test email sending.
 *
 * Renders SMTP host, port, credentials, and from-address fields.
 * Persists via the existing `set_setting` / `get_setting` Tauri
 * commands using the `smtp_config` settings key as JSON.
 */

import { useState, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useToast } from '@/frontend/shared/Toast';
import { requiredLocalized } from '@/frontend/shared';
import Tooltip from '@/frontend/shell/Tooltip';
import { getReportSchedule, getReportScheduleScoped, saveReportSchedule, type ReportScheduleConfig } from '@/api/email';
import { getSettingScoped, setSettingScoped } from '@/api/settings';
import { useWorkspace } from '@/contexts/WorkspaceContext';

interface SmtpConfigDto {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  from: string;
  use_tls: boolean;
}

const DEFAULT_SMTP: SmtpConfigDto = {
  host: '',
  port: 587,
  username: null,
  password: null,
  from: '',
  use_tls: true,
};

const SMTP_CONFIG_KEY = 'smtp_config';

export default function EmailReportSettings() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken ?? '';
  // `const userId = useAuth().session?.user_id ?? 'default'` used to sit here. Nothing read it; it
  // existed only to satisfy the useCallback dependency array that has just been dropped, and
  // removing one link exposed the next (the binding, then the import).

  const [config, setConfig] = useState<SmtpConfigDto>(DEFAULT_SMTP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // ── Schedule state ────────────────────────────────────────────────
  const [schedule, setSchedule] = useState<ReportScheduleConfig>({
    enabled: false,
    cadence: 'daily',
    report_types: ['daily_revenue', 'top_products'],
    recipients: [],
    send_at_time: '08:00',
    timezone: 'UTC',
    lookback_days: 1,
  });
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const raw = await getSettingScoped(sessionToken ?? null, SMTP_CONFIG_KEY);
      if (raw) {
        setConfig({ ...DEFAULT_SMTP, ...JSON.parse(raw) });
      }
    } catch {
      // Settings key doesn't exist yet — use defaults
    } finally {
      setLoading(false);
    }
    // sessionToken is read at :70 and derived from useWorkspace() at :44. This array was empty,
    // and :81 is `useEffect(() => { loadConfig(); }, [loadConfig])` with no latch, so loadConfig's
    // identity is the only thing that re-triggers the fetch -- it never changed, so the SMTP
    // config shown after a store switch was still the previous store's.
  }, [sessionToken]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Load schedule config ───────────────────────────────────────────
  const loadSchedule = useCallback(async () => {
    try {
      // ADR #7 conditional scoping. get_report_schedule_scoped enforces REPORTS_SCHEDULE; the
      // unscoped command checks nothing, while the save path in this same screen already
      // requires a token (api/email.ts:29).
      const sched = sessionToken
        ? await getReportScheduleScoped(sessionToken)
        : await getReportSchedule();
      // getReportSchedule returns null when no schedule exists yet
      // (Tauri IPC resolves with null for unset data). Guard against
      // overwriting the initial default values with null.
      if (sched) setSchedule(sched);
    } catch {
      // Use defaults
    } finally {
      setScheduleLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Validate
      if (!config.host.trim()) {
        addToast({ message: l10n.getString('settings-email-host-required'), type: 'error' });
        setSaving(false);
        return;
      }
      if (!config.from.trim() || !config.from.includes('@')) {
        addToast({ message: l10n.getString('settings-email-from-required'), type: 'error' });
        setSaving(false);
        return;
      }

      await setSettingScoped(sessionToken, SMTP_CONFIG_KEY, JSON.stringify(config));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      addToast({ message: l10n.getString('settings-email-saved'), type: 'success' });
    } catch {
      addToast({ message: l10n.getString('settings-email-save-error'), type: 'error' });
    } finally {
      setSaving(false);
    }
    // sessionToken is read at :116 by setSettingScoped. `userId` used to be listed here and is a
    // different value, so it never covered the token: saving after a store switch wrote SMTP
    // credentials to the previous store -- or failed on the destroyed session, after the success
    // toast had already been scheduled on the happy path. `userId` has since been dropped: nothing
    // in this component read it, and its presence in the array was the only thing keeping the
    // binding from being reported as unused.
  }, [config, l10n, addToast, sessionToken]);

  // ── Schedule event handlers ────────────────────────────────────────

  const saveSchedule = useCallback(async () => {
    setScheduleSaving(true);
    try {
      // Strip empty recipient entries before persisting.
      const cleaned = { ...schedule, recipients: schedule.recipients.filter((r) => r.trim() !== '') };
      setSchedule(cleaned);
      await saveReportSchedule(sessionToken, cleaned);
      addToast({
        message: l10n.getString('settings-email-schedule-saved'),
        type: 'success',
      });
    } catch (err) {
      addToast({
        message: typeof err === 'string' ? err : l10n.getString('settings-email-schedule-save-failed'),
        type: 'error',
      });
    } finally {
      setScheduleSaving(false);
    }
  }, [schedule, l10n, addToast, sessionToken]);

  const updateSchedField = useCallback(
    <K extends keyof ReportScheduleConfig>(key: K, value: ReportScheduleConfig[K]) => {
      setSchedule((prev) => ({ ...prev, [key]: value }));
    },
    [],
  ) as <K extends keyof ReportScheduleConfig>(key: K, value: ReportScheduleConfig[K]) => void;

  const handleSendTest = useCallback(async () => {
    setSending(true);
    try {
      // Dynamically import the email API to avoid circular deps
      const { sendTestReport } = await import('@/api/email');
      const message = await sendTestReport(sessionToken);
      addToast({ message, type: 'success' });
    } catch (err) {
      const errorMessage = typeof err === 'string' ? err : l10n.getString('settings-email-test-send-failed');
      addToast({ message: errorMessage, type: 'error' });
    } finally {
      setSending(false);
    }
  }, [addToast, l10n, sessionToken]);

  const updateField = useCallback(
    <K extends keyof SmtpConfigDto>(key: K, value: SmtpConfigDto[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  if (loading) {
    return (
      <Card shadow="sm" header={l10n.getString('settings-section-email')}>
        <div className="settings-loading-inline" style={{ padding: '1rem', textAlign: 'center', color: '#9ca3af' }}>
          <Localized id="settings-email-loading">
            <span>Loading email settings…</span>
          </Localized>
        </div>
      </Card>
    );
  }

  return (
    <>
    <Card
      shadow="sm"
      header={
        <h2 className="settings-section-title">
          <Localized id="settings-section-email">
            <span>Email Reports</span>
          </Localized>
        </h2>
      }
    >
      <div className="settings-form">
        <p className="settings-hint" style={{ marginBottom: '1rem' }}>
          <Localized id="settings-email-description">
            <span>Configure SMTP to receive scheduled report emails.</span>
          </Localized>
        </p>

        {/* SMTP Host */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-email-host" className="settings-label">
            {l10n.getString('settings-email-host')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="text"
              id="settings-email-host"
              placeholder="smtp.example.com"
              value={config.host}
              onChange={(e) => updateField('host', e.target.value)}
              autoComplete="off"
              data-gramm="false"
            />
          </span>
        </div>

        {/* SMTP Port */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-email-port" className="settings-label">
            {l10n.getString('settings-email-port')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="number"
              id="settings-email-port"
              min={1}
              max={65535}
              value={config.port}
              onChange={(e) => {
                // SMTP ports are whole numbers — ignore fractional in-progress
                // input instead of silently truncating it via parseInt.
                const v = Number(e.target.value);
                if (e.target.value === '' || Number.isInteger(v)) {
                  updateField('port', e.target.value === '' ? 587 : v);
                }
              }}
              style={{ maxWidth: '120px' }}
            />
          </span>
        </div>

        {/* SMTP Username */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-email-username" className="settings-label">
            {l10n.getString('settings-email-username')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="text"
              id="settings-email-username"
              placeholder={l10n.getString('settings-email-username-placeholder')}
              value={config.username ?? ''}
              onChange={(e) => updateField('username', e.target.value || null)}
              autoComplete="off"
              data-gramm="false"
            />
          </span>
        </div>

        {/* SMTP Password */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-email-password" className="settings-label">
            {l10n.getString('settings-email-password')}
          </label>
          <span className="settings-field-input-wrap">
            <div className="settings-input-wrap">
              <input
                className="settings-input"
                type={showPassword ? 'text' : 'password'}
                id="settings-email-password"
                placeholder={l10n.getString('settings-email-password-placeholder')}
                value={config.password ?? ''}
                onChange={(e) => updateField('password', e.target.value || null)}
                autoComplete="off"
                data-gramm="false"
              />
              <button
                type="button"
                className="settings-input-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={l10n.getString(showPassword ? 'settings-email-password-hide' : 'settings-email-password-show')}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </span>
        </div>

        {/* From address */}
        <div className="settings-field settings-field--horizontal">
          <label htmlFor="settings-email-from" className="settings-label">
            {l10n.getString('settings-email-from')}
          </label>
          <span className="settings-field-input-wrap">
            <input
              className="settings-input"
              type="email"
              id="settings-email-from"
              placeholder="reports@mystore.com"
              value={config.from}
              onChange={(e) => updateField('from', e.target.value)}
              autoComplete="off"
              data-gramm="false"
            />
          </span>
        </div>

        {/* Use TLS toggle */}
        <div className="settings-field settings-field--horizontal">
          <span className="settings-label" id="settings-email-use-tls-label">
            <Localized id="settings-email-use-tls">
              <span>Use STARTTLS</span>
            </Localized>
          </span>
          <span className="settings-field-input-wrap">
            <label className="settings-toggle" htmlFor="settings-email-use-tls">
              <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
              <span className="settings-toggle-switch">
                <input
                  id="settings-email-use-tls"
                  type="checkbox"
                  role="switch"
                  checked={config.use_tls}
                  aria-checked={config.use_tls}
                  aria-labelledby="settings-email-use-tls-label"
                  onChange={(e) => updateField('use_tls', e.target.checked)}
                />
                <span className="settings-toggle-slider" />
              </span>
            </label>
          </span>
        </div>

        {/* Action buttons */}
        <div className="settings-field settings-field--horizontal" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '0.5rem' }}>
          <span />
          <span className="settings-field-input-wrap" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={saveConfig}
              disabled={saving}
              aria-label={l10n.getString('settings-email-save-btn')}
            >
              {saving ? (
                <span className="btn-spinner" aria-hidden="true" />
              ) : saved ? (
                <Localized id="settings-email-saved-btn">
                  <span>Saved ✓</span>
                </Localized>
              ) : (
                <Localized id="settings-email-save-btn">
                  <span>Save SMTP Settings</span>
                </Localized>
              )}
            </Button>

            <Tooltip content={l10n.getString('settings-email-test-tooltip')}>
              <Button
                variant="secondary"
                onClick={handleSendTest}
                disabled={sending || !config.host.trim()}
                aria-label={l10n.getString('settings-email-test-btn')}
              >
                {sending ? (
                  <>
                    <span className="btn-spinner" aria-hidden="true" />
                    <Localized id="settings-email-sending">
                      <span> Sending…</span>
                    </Localized>
                  </>
                ) : (
                  <Localized id="settings-email-test-btn">
                    <span>Send Test Report</span>
                  </Localized>
                )}
              </Button>
            </Tooltip>
          </span>
        </div>
      </div>
    </Card>

    {/* ── Report Schedule Configuration ──────────────────────────────────── */}
    <div style={{ height: '1.5rem' }} />
    <Card
      shadow="sm"
      header={
        <h2 className="settings-section-title">
          <Localized id="settings-section-schedule">
            <span>Report Schedule</span>
          </Localized>
        </h2>
      }
    >
      {scheduleLoading ? (
        <div className="settings-loading-inline" style={{ padding: '1rem', textAlign: 'center', color: '#9ca3af' }}>
          <Localized id="settings-schedule-loading">
            <span>Loading schedule…</span>
          </Localized>
        </div>
      ) : (
        <div className="settings-form">
          <p className="settings-hint" style={{ marginBottom: '1rem' }}>
            <Localized id="settings-schedule-description">
              <span>Configure how often scheduled report emails are sent.</span>
            </Localized>
          </p>

          {/* Enabled toggle */}
          <div className="settings-field settings-field--horizontal">
            <span className="settings-label" id="settings-schedule-enabled-label">
              <Localized id="settings-schedule-enabled">
                <span>Enable Scheduled Reports</span>
              </Localized>
            </span>
            <span className="settings-field-input-wrap">
              <label className="settings-toggle" htmlFor="settings-schedule-enabled">
                <span className="sr-only">{requiredLocalized(l10n, 'toggle')}</span>
                <span className="settings-toggle-switch">
                  <input
                    id="settings-schedule-enabled"
                    type="checkbox"
                    role="switch"
                    checked={schedule.enabled}
                    aria-checked={schedule.enabled}
                    aria-labelledby="settings-schedule-enabled-label"
                    onChange={(e) => updateSchedField('enabled', e.target.checked)}
                  />
                  <span className="settings-toggle-slider" />
                </span>
              </label>
            </span>
          </div>

          {/* Cadence / Frequency */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="settings-schedule-cadence" className="settings-label">
              {l10n.getString('settings-schedule-cadence')}
            </label>
            <span className="settings-field-input-wrap">
              <select
                id="settings-schedule-cadence"
                className="settings-select"
                value={schedule.cadence}
                onChange={(e) => updateSchedField('cadence', e.target.value)}
                aria-label={l10n.getString('settings-schedule-cadence')}
                style={{ width: '100%', maxWidth: '320px' }}
              >
                <option value="daily">{requiredLocalized(l10n, 'settings-schedule-cadence-daily')}</option>
                <option value="weekly">{requiredLocalized(l10n, 'settings-schedule-cadence-weekly')}</option>
                <option value="monthly">{requiredLocalized(l10n, 'settings-schedule-cadence-monthly')}</option>
              </select>
            </span>
          </div>

          {/* Send time */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="settings-schedule-time" className="settings-label">
              {l10n.getString('settings-schedule-time')}
            </label>
            <span className="settings-field-input-wrap">
              <input
                id="settings-schedule-time"
                className="settings-input"
                type="time"
                value={schedule.send_at_time}                    onChange={(e) => updateSchedField('send_at_time', e.target.value)}
                aria-label={l10n.getString('settings-schedule-time')}
                style={{ maxWidth: '160px' }}
              />
            </span>
          </div>

          {/* Timezone */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="settings-schedule-tz" className="settings-label">
              {l10n.getString('settings-schedule-timezone')}
            </label>
            <span className="settings-field-input-wrap">
              <input
                id="settings-schedule-tz"
                className="settings-input"
                type="text"
                value={schedule.timezone}                    onChange={(e) => updateSchedField('timezone', e.target.value)}
                placeholder="UTC"
                aria-label={l10n.getString('settings-schedule-timezone')}
                style={{ maxWidth: '220px' }}
              />
            </span>
          </div>

          {/* Lookback days */}
          <div className="settings-field settings-field--horizontal">
            <label htmlFor="settings-schedule-lookback" className="settings-label">
              {l10n.getString('settings-schedule-lookback')}
            </label>
            <span className="settings-field-input-wrap">
              <input
                id="settings-schedule-lookback"
                className="settings-input"
                type="number"
                min={1}
                max={365}
                value={schedule.lookback_days}
                onChange={(e) => {
                  // Lookback days are whole numbers — ignore fractional input
                  // instead of silently truncating it via parseInt.
                  const v = Number(e.target.value);
                  if (e.target.value === '' || Number.isInteger(v)) {
                    updateSchedField('lookback_days', e.target.value === '' ? 1 : v);
                  }
                }}
                aria-label={l10n.getString('settings-schedule-lookback')}
                style={{ maxWidth: '120px' }}
              />
            </span>
          </div>

          {/* Report types */}
          <div className="settings-field settings-field--horizontal" style={{ alignItems: 'flex-start' }}>
            <span className="settings-label">
              <Localized id="settings-schedule-report-types">
                <span>Report Types</span>
              </Localized>
            </span>
            <span className="settings-field-input-wrap">
              <div className="settings-checkbox-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {([
                  ['daily_revenue', 'settings-schedule-report-type-daily-revenue'],
                  ['weekly_revenue', 'settings-schedule-report-type-weekly-revenue'],
                  ['monthly_revenue', 'settings-schedule-report-type-monthly-revenue'],
                  ['top_products', 'settings-schedule-report-type-top-products'],
                  ['hourly_heatmap', 'settings-schedule-report-type-hourly-heatmap'],
                  ['category_breakdown', 'settings-schedule-report-type-category-breakdown'],
                  ['low_stock_alerts', 'settings-schedule-report-type-low-stock-alerts'],
                ] as const).map(([key, i18nKey]) => {
                  const localized = requiredLocalized(l10n, i18nKey);
                  return (
                    <label key={key} className="settings-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={schedule.report_types.includes(key)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...schedule.report_types, key]
                            : schedule.report_types.filter((r) => r !== key);
                          updateSchedField('report_types', next);
                        }}
                        aria-label={localized}
                      />
                      <span>{localized}</span>
                    </label>
                  );
                })}
              </div>
            </span>
          </div>

          {/* Recipients */}
          <div className="settings-field settings-field--horizontal" style={{ alignItems: 'flex-start' }}>
            <span className="settings-label">
              {l10n.getString('settings-schedule-recipients')}
            </span>
            <span className="settings-field-input-wrap">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                {schedule.recipients.map((email, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      className="settings-input"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        const next = [...schedule.recipients];
                        next[i] = e.target.value;
                        updateSchedField('recipients', next);
                      }}
                      aria-label={l10n.getString('settings-schedule-recipient-aria', { number: String(i + 1) })}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="settings-remove-btn"
                      onClick={() => {
                        const next = schedule.recipients.filter((_, j) => j !== i);
                        updateSchedField('recipients', next);
                      }}
                      aria-label={l10n.getString('settings-schedule-recipient-remove-aria', { number: String(i + 1) })}
                      style={{
                        background: 'none',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        color: '#ef4444',
                        fontSize: '0.875rem',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  onClick={() => updateSchedField('recipients', [...schedule.recipients, ''])}
                  aria-label={l10n.getString('settings-schedule-recipient-add-aria')}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <Localized id="settings-schedule-add-recipient">
                    <span>+ Add Recipient</span>
                  </Localized>
                </Button>
              </div>
            </span>
          </div>

          {/* Save schedule button */}
          <div className="settings-field settings-field--horizontal" style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <span />
            <span className="settings-field-input-wrap">
              <Button
                variant="primary"
                onClick={saveSchedule}
                loading={scheduleSaving}
                aria-label={l10n.getString('settings-schedule-save-btn')}
              >
                {scheduleSaving ? (
                  <span className="btn-spinner" aria-hidden="true" />
                ) : (
                  <Localized id="settings-schedule-save-btn">
                    <span>Save Schedule</span>
                  </Localized>
                )}
              </Button>
            </span>
          </div>
        </div>
      )}
    </Card>
    </>
  );
}
