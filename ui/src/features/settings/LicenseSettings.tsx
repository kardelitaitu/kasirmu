import { useState, useEffect, useCallback, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { getLicenseStatus, checkLicenseStatus, pauseSubscription, pauseSubscriptionScoped, resumeSubscription, resumeSubscriptionScoped, type ServerLicenseStatus } from '@/api/license';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import ExitSurveyModal from '@/components/ExitSurveyModal';
import { useToast } from '@/components/Toast';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { l10nErrorMessage } from '@/utils/app-error';
import { isTabletShell } from '@/utils/shellKind';
import './LicenseSettings.css';
import OverQuotaCard from './OverQuotaCard';

/** Parsed subscription payload from the license server's signed JSON. */
interface LicensePayload {
  tenant_id: string;
  tier_key: string;
  status: string;
  max_stores: number;
  max_pos_instances: number;
  allowed_types: string[];
  starts_at: string;
  expires_at: string;
  grace_until: string;
  issued_at: string;
}

/** Format an RFC 3339 date string for display in the active locale. */
function formatDate(rfc3339: string, locale: string): string {
  try {
    const d = new Date(rfc3339);
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return rfc3339;
  }
}

/** Human-readable tier label via l10n. */
function tierLabel(tier: string, l10n: ReturnType<typeof useLocalization>['l10n']): string {
  const key = `settings-license-tier-${tier}`;
  const v = l10n.getString(key);
  return v !== key ? v : tier;
}

/** Human-readable labels for workspace type slugs via l10n. */
function workspaceTypeLabel(type: string, l10n: ReturnType<typeof useLocalization>['l10n']): string {
  const key = `settings-license-ws-${type}`;
  const v = l10n.getString(key);
  return v !== key ? v : type;
}

/** Format a relative time (ms since epoch) into a human-friendly string. */
function relativeTime(ms: number, l10n: ReturnType<typeof useLocalization>['l10n']): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 5) return l10n.getString('settings-license-just-now');
  if (seconds < 60) return l10n.getString('settings-license-seconds-ago', { seconds: String(seconds) });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return l10n.getString('settings-license-minutes-ago', { minutes: String(minutes) });
  const d = new Date(ms);
  return d.toLocaleTimeString([...l10n.bundles][0]?.locales[0] ?? 'en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Duration (ms) for row flash after a server status update. */
const FLASH_DURATION = 1_400;

/** Polling interval for server status checks.
 *
 * 5 minutes, not 30 seconds: the licence server meters a shared credential lane
 * (~5 requests/hour) and licence state simply does not change that fast, so a
 * 30-second poll spent ~120 requests/hour to learn nothing. This is a server-load
 * and battery trade-off — use the Refresh button for an immediate check. */
export const POLL_INTERVAL_MS = 300_000;

/** Maximum consecutive failures before showing offline indicator. */
const MAX_POLL_FAILURES = 3;

/** The ADR #58 §2.3 re-authentication window: 3 days before `expires_at`. */
export const REAUTH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Whether the licence poll may run for this payload (ADR #58 §2.3 / §4a Q-B
 * option B).
 *
 * The rule from §2.3, arm for arm:
 *
 * - **Free tier** → never poll. There is no expiry to approach and nothing to
 *   revoke; the tier is the floor.
 * - **No/unparseable `expires_at`** → never poll. §2.3's `NULL` arm: a
 *   perpetual or lifetime licence has no window for the 3 days to precede, and
 *   a malformed timestamp must fail open rather than manufacture an obligation.
 * - **Outside the last 3 days** → never poll. The device operates on its
 *   locally stored signed subscription.
 * - **Inside the last 3 days** → poll. Re-authentication is owed.
 *
 * **Why gate at all.** The poll is the only live revocation path for a
 * connected device until the daemon ride-along shipped
 * (`platform/sync/src/daemon_tick.rs` `run_license_ride_along`), so the
 * daemon now carries that duty on its own 60–120s cadence for every
 * configured terminal — including one whose Settings screen is closed. Gating
 * this in-screen poll then costs no revocation latency while removing load
 * that scaled with *screens left open* rather than with tenants near renewal.
 *
 * Exported for the unit test; not part of the component's public API.
 */
export function shouldPollLicense(
  payload: Pick<LicensePayload, 'tier_key' | 'expires_at'> | null,
  nowMs: number,
): boolean {
  if (!payload) return false;
  if (payload.tier_key === 'free') return false;
  const expiresAt = Date.parse(payload.expires_at);
  if (Number.isNaN(expiresAt)) return false;
  return nowMs >= expiresAt - REAUTH_WINDOW_MS;
}

/** License settings section — displays tier, expiry, grace period, and quotas. */
export default function LicenseSettings() {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { addToast } = useToast();
  // Pause/resume are billing actions and both commands are registered on the
  // desktop shell only, so the tablet renders the subscription state without the
  // two buttons. Read once, like the other shell checks.
  const actionsAvailable = !isTabletShell();
  // This screen is rendered from SettingsPage (:824), inside WorkspaceProvider, so a session
  // exists. The token was not previously in scope here at all -- which is why both subscription
  // actions were reaching the unscoped, unchecked commands.
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<LicensePayload | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerLicenseStatus | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);

  // Track the interval ID so we can clear it on unmount.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Row flash animation ─────────────────────────────────────────
  // Track recently-updated rows for a brief green background pulse.
  const [flashRows, setFlashRows] = useState<Map<string, 'updated'>>(new Map());
  // C3.3: Pause/resume subscription state
  const [pausing, setPausing] = useState(false);
  const [showExitSurvey, setShowExitSurvey] = useState(false);
  const [resuming, setResuming] = useState(false);
  const flashTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const triggerFlash = useCallback((key: string) => {
    setFlashRows((prev) => {
      const next = new Map(prev);
      next.set(key, 'updated');
      return next;
    });
    const existing = flashTimeoutsRef.current.get(key);
    if (existing) clearTimeout(existing);
    const tid = setTimeout(() => {
      setFlashRows((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      flashTimeoutsRef.current.delete(key);
    }, FLASH_DURATION);
    flashTimeoutsRef.current.set(key, tid);
  }, []);

  // Cleanup flash timeouts on unmount.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    return () => {
      flashTimeoutsRef.current.forEach((tid) => clearTimeout(tid));
      flashTimeoutsRef.current.clear();
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Track mount state to avoid setState after unmount.
  const mountedRef = useRef(true);

  // On unmount, mark as unmounted (separate from polling cleanup to
  // avoid timing bug where re-running the polling effect's cleanup
  // would set mountedRef=false before the new effect starts).
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  /** Single poll tick — calls checkLicenseStatus silently (no toast). */
  const pollTick = useCallback(async () => {
    try {
      const status = await checkLicenseStatus();
      if (!mountedRef.current) return;
      setServerStatus(status);
      setLastCheckedAt(Date.now());
      setPollFailures(0);
      setPollError(null);
      triggerFlash('server-status');
    } catch {
      if (!mountedRef.current) return;
      setPollFailures((prev) => {
        const next = prev + 1;
        if (next >= MAX_POLL_FAILURES) {
          setPollError(l10nRef.current.getString('settings-license-poll-offline'));
        }
        return next;
      });
    }
  }, [triggerFlash]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const status = await getLicenseStatus();
      if (status.payload) {
        const parsed: LicensePayload = JSON.parse(status.payload);
        setPayload(parsed);
      } else if (status.tier) {
        // Payload unavailable (expired/missing) but Rust still returns tier.
        // Build a minimal payload so the tier row is visible.
        setPayload({
          tenant_id: '',
          tier_key: status.tier,
          status: status.status,
          max_stores: 0,
          max_pos_instances: 0,
          allowed_types: [],
          starts_at: '',
          expires_at: '',
          grace_until: '',
          issued_at: '',
        });
      }
    } catch (err) {
      setLoadError(l10nErrorMessage(err, l10nRef.current, 'settings-license-load-failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => { load(); }, [load]);

  // Start polling after initial load succeeds and user has a payload, and
  // only inside the §2.3 re-authentication window (see shouldPollLicense).
  //
  // Below the window there is no timer armed at all: the screen keeps whatever
  // the initial load returned and the user can press Refresh for an immediate
  // check. The daemon ride-along covers revocation for a closed screen.
  useEffect(() => {
    if (!payload) return;
    if (!shouldPollLicense(payload, Date.now())) return;

    // Fire first poll immediately.
    void pollTick();

    intervalRef.current = setInterval(pollTick, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [payload, pollTick]);

  /** Manual refresh — calls checkLicenseStatus with a toast. */
  const handleRefresh = useCallback(async () => {
    setCheckingServer(true);
    try {
      const status = await checkLicenseStatus();
      setServerStatus(status);
      setLastCheckedAt(Date.now());
      setPollFailures(0);
      setPollError(null);
      triggerFlash('server-status');
      addToast({ type: 'info', message: l10n.getString('settings-license-server-status-retrieved') });
    } catch (err) {
      const msg = l10nErrorMessage(err, l10n, 'settings-license-server-check-failed');
      addToast({ type: 'error', message: msg });
    } finally {
      setCheckingServer(false);
    }
  }, [addToast, l10n, triggerFlash]);

  /** C3.3: Pause the subscription for 1 month. */
  const handlePauseConfirm = useCallback(async () => {
    setShowExitSurvey(false);
    setPausing(true);
    try {
      // ADR #7 conditional scoping. pause_subscription_scoped enforces SETTINGS_EDIT; the
      // unscoped command reads the stored API key and calls the billing server unchecked.
      await (sessionToken
        ? pauseSubscriptionScoped(sessionToken, 1)
        : pauseSubscription(1));
      addToast({ type: 'info', message: l10n.getString('settings-license-pause-success') });
      const status = await checkLicenseStatus();
      setServerStatus(status);
    } catch (err) {
      const msg = l10nErrorMessage(err, l10n, 'settings-license-pause-failed');
      addToast({ type: 'error', message: msg });
    } finally {
      setPausing(false);
    }
  }, [addToast, l10n, sessionToken]);

  /** Show exit survey before pausing. */
  const handlePause = useCallback(() => {
    setShowExitSurvey(true);
  }, []);

  /** C3.3: Resume a paused subscription. */
  const handleResume = useCallback(async () => {
    setResuming(true);
    try {
      // Same differential as handlePauseConfirm: resume_subscription_scoped enforces
      // SETTINGS_EDIT, the unscoped variant checks nothing.
      await (sessionToken ? resumeSubscriptionScoped(sessionToken) : resumeSubscription());
      addToast({ type: 'info', message: l10n.getString('settings-license-resume-success') });
      // Reload status to reflect active state
      const status = await checkLicenseStatus();
      setServerStatus(status);
    } catch (err) {
      const msg = l10nErrorMessage(err, l10n, 'settings-license-resume-failed');
      addToast({ type: 'error', message: msg });
    } finally {
      setResuming(false);
    }
  }, [addToast, l10n, sessionToken]);

  // ── Loading / Error states ──────────────────────────────────
  if (loading) {
    return (
      <Card shadow="sm" header={<Localized id="settings-section-license"><h2 className="settings-section-title">License</h2></Localized>}>
        <div className="settings-license-skeleton" role="status" aria-live="polite" aria-label={l10n.getString('settings-loading')}>
          <div className="settings-license-skeleton-row">
            <span className="settings-license-skeleton-label" />
            <span className="settings-license-skeleton-value" />
          </div>
          <div className="settings-license-skeleton-row">
            <span className="settings-license-skeleton-label" />
            <span className="settings-license-skeleton-value" />
          </div>
          <div className="settings-license-skeleton-row">
            <span className="settings-license-skeleton-label" />
            <span className="settings-license-skeleton-value" />
          </div>
          <div className="settings-license-skeleton-row">
            <span className="settings-license-skeleton-label" />
            <span className="settings-license-skeleton-value" />
          </div>
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card shadow="sm" header={<Localized id="settings-section-license"><h2 className="settings-section-title">License</h2></Localized>}>
        <div className="settings-form">
          <div className="settings-error" role="alert">
            <p>{loadError}</p>
            <Button variant="secondary" onClick={() => { setLoadError(null); load(); }} aria-label={l10n.getString('settings-retry')}>
              <Localized id="settings-retry"><span>Retry</span></Localized>
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!payload) {
    return (
      <Card shadow="sm" header={<Localized id="settings-section-license"><h2 className="settings-section-title">License</h2></Localized>}>
        <div className="settings-license-empty" role="status">
          <svg className="settings-license-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <Localized id="settings-license-not-activated">
            <p className="settings-license-empty-text">No license activated. Activate a license to see details here.</p>
          </Localized>
        </div>
      </Card>
    );
  }

  // ── Main render ─────────────────────────────────────────────
  const now = Date.now();
  const expiresAtMs = payload ? Date.parse(payload.expires_at) : NaN;
  const isPreExpiry =
    payload !== null &&
    payload.tier_key !== 'free' &&
    payload.status === 'active' &&
    !Number.isNaN(expiresAtMs) &&
    now >= expiresAtMs - REAUTH_WINDOW_MS &&
    now < expiresAtMs;
  const preExpiryDaysRemaining = isPreExpiry
    ? Math.max(1, Math.ceil((expiresAtMs - now) / (24 * 60 * 60 * 1000)))
    : 0;

  return (
    <Card shadow="sm" header={<Localized id="settings-section-license"><h2 className="settings-section-title">License</h2></Localized>}>
      <div className="settings-form settings-license-section" role="region" aria-label={l10n.getString('settings-section-license')}>

        {/* ── Pre-expiry re-authentication prompt (ADR #58 §2.3) ── */}
        {isPreExpiry && (
          <div
            className="settings-license-reauth-banner"
            role="alert"
            data-testid="license-reauth-banner"
          >
            <div className="settings-license-reauth-content">
              <span className="settings-license-reauth-title">
                <Localized id="settings-license-reauth-banner-title">
                  <span>Subscription Renewal Check Required</span>
                </Localized>
              </span>
              <span className="settings-license-reauth-desc">
                <Localized
                  id="settings-license-reauth-banner-desc"
                  vars={{ days: preExpiryDaysRemaining }}
                >
                  <span>
                    Your subscription expires in {preExpiryDaysRemaining} days. Connect to the internet to re-authenticate with the license server.
                  </span>
                </Localized>
              </span>
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={checkingServer}
              onClick={handleRefresh}
              aria-label={l10n.getString('settings-license-reauth-action')}
            >
              <Localized id="settings-license-reauth-action">
                <span>Verify Online Now</span>
              </Localized>
            </Button>
          </div>
        )}

        {/* ── Subscription details from local payload ── */}
        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-tier"><span>Tier</span></Localized>
          </span>
          <span className={`settings-license-value settings-license-value--tier settings-license-value--tier-${payload.tier_key}`}>
            {tierLabel(payload.tier_key, l10n)}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-status-label"><span>Status</span></Localized>
          </span>
          <span className={`settings-license-value${payload.status === 'active' ? ' settings-license-value--active' : ' settings-license-value--warning'}`}>
            {payload.status === 'active' ? l10n.getString('settings-license-status-active') : payload.status}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-expires"><span>Expires</span></Localized>
          </span>
          <span className="settings-license-value">
            {formatDate(payload.expires_at, [...l10n.bundles][0]?.locales[0] ?? 'en-US')}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-grace"><span>Grace Period Until</span></Localized>
          </span>
          <span className="settings-license-value">
            {formatDate(payload.grace_until, [...l10n.bundles][0]?.locales[0] ?? 'en-US')}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-max-stores"><span>Max Stores</span></Localized>
          </span>
          <span className="settings-license-value settings-license-value--mono">
            {payload.max_stores === 0 ? l10n.getString('settings-license-unlimited') : String(payload.max_stores)}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-max-pos"><span>Max POS Instances</span></Localized>
          </span>
          <span className="settings-license-value settings-license-value--mono">
            {payload.max_pos_instances === 0 ? l10n.getString('settings-license-unlimited') : String(payload.max_pos_instances)}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-tenant-id"><span>Tenant ID</span></Localized>
          </span>
          <span className="settings-license-value settings-license-value--mono">
            {payload.tenant_id}
          </span>
        </div>

        <div className="settings-license-row">
          <span className="settings-license-label">
            <Localized id="settings-license-allowed-types"><span>Allowed Workspace Types</span></Localized>
          </span>
          <span className="settings-license-value">
            {(payload.allowed_types ?? []).length === 0
              ? (<Localized id="settings-license-allowed-types-all"><span>All</span></Localized>)
              : payload.allowed_types.map((t) => workspaceTypeLabel(t, l10n)).join(', ')}
          </span>
        </div>

        {/* ── Live status indicator ── */}
        <div className={`settings-license-row settings-license-row--status${flashRows.has('server-status') ? ' settings-license-row--flash-updated' : ''}`}>
          <span className="settings-license-label">
            <Localized id="settings-license-server-status"><span>Server Status</span></Localized>
          </span>
          <span className="settings-license-value settings-license-value--status">
            <span
              className={`settings-license-live-dot ${pollError || (lastCheckedAt !== null && pollFailures >= MAX_POLL_FAILURES) ? 'settings-license-live-dot--offline' : serverStatus ? 'settings-license-live-dot--online' : 'settings-license-live-dot--unknown'}`}
              aria-hidden="true"
            />
            {pollError ? (
              <Localized id="settings-license-live-offline"><span>Offline</span></Localized>
            ) : serverStatus?.active ? (
              <Localized id="settings-license-live-online"><span>Live</span></Localized>
            ) : serverStatus && !serverStatus.active ? (
              <Localized id="settings-license-live-inactive"><span>Inactive</span></Localized>
            ) : (
              <Localized id="settings-license-live-checking"><span>Checking…</span></Localized>
            )}
          </span>
        </div>

        {/* ── Last checked timestamp ── */}
        {lastCheckedAt !== null && (
          <div className="settings-license-row settings-license-row--last-checked">
            <span className="settings-license-label" aria-live="polite">
              <Localized
                id="settings-license-last-checked"
                vars={{ when: relativeTime(lastCheckedAt, l10n) }}
              >
                <span>Last checked: {relativeTime(lastCheckedAt, l10n)}</span>
              </Localized>
            </span>
            <span className="settings-license-value">
              <Button
                variant="ghost"
                size="sm"
                loading={checkingServer}
                onClick={handleRefresh}
                aria-label={l10n.getString('settings-license-refresh-aria')}
              >
                <Localized id="settings-license-refresh">
                  <span>Refresh</span>
                </Localized>
              </Button>
            </span>
          </div>
        )}

        {/* ── Server results (shown automatically after first poll) ── */}
        {serverStatus && (
          <div className={`settings-license-server-section${flashRows.has('server-status') ? ' settings-license-server-section--flash' : ''}`} role="region" aria-label={l10n.getString('settings-license-server-results')}>
            <div className="settings-license-row">
              <span className="settings-license-label">
                <Localized id="settings-license-server-tier"><span>Server Tier</span></Localized>
              </span>
              <span className={`settings-license-value settings-license-value--tier settings-license-value--tier-${serverStatus.tier}`}>
                {tierLabel(serverStatus.tier, l10n)}
              </span>
            </div>
            <div className="settings-license-row">
              <span className="settings-license-label">
                <Localized id="settings-license-server-active"><span>Server Active</span></Localized>
              </span>
              <span className={`settings-license-value${serverStatus.active ? ' settings-license-value--active' : ' settings-license-value--warning'}`}>
                {serverStatus.active ? l10n.getString('settings-license-yes') : l10n.getString('settings-license-no')}
              </span>
            </div>
            {serverStatus.expiresAt && (
              <div className="settings-license-row">
                <span className="settings-license-label">
                  <Localized id="settings-license-server-expires"><span>Server Expires</span></Localized>
                </span>
                <span className="settings-license-value">
                  {formatDate(serverStatus.expiresAt, [...l10n.bundles][0]?.locales[0] ?? 'en-US')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── C3.3: Pause / Resume subscription ── */}
        {actionsAvailable && payload.status === 'active' && (
          <div className="settings-license-row settings-license-row--actions">
            <span className="settings-license-label">
              <Localized id="settings-license-subscription-actions"><span>Subscription</span></Localized>
            </span>
            <span className="settings-license-value">
              <Button
                variant="secondary"
                size="sm"
                loading={pausing}
                onClick={handlePause}
                aria-label={l10n.getString('settings-license-pause-aria')}
              >
                <Localized id="settings-license-pause-subscription">
                  <span>Pause subscription</span>
                </Localized>
              </Button>
            </span>
          </div>
        )}
        {payload.status === 'paused' && (
          <div className="settings-license-row settings-license-row--warning">
            <span className="settings-license-label">
              <Localized id="settings-license-paused-until"><span>Paused until</span></Localized>
            </span>
            <span className="settings-license-value settings-license-value--warning">
              {formatDate(serverStatus?.expiresAt ?? payload.expires_at, [...l10n.bundles][0]?.locales[0] ?? 'en-US')}
            </span>
          </div>
        )}
        {actionsAvailable && payload.status === 'paused' && (
          <div className="settings-license-row settings-license-row--actions">
            <span className="settings-license-label">
              <Localized id="settings-license-subscription-actions"><span>Subscription</span></Localized>
            </span>
            <span className="settings-license-value">
              <Button
                variant="primary"
                size="sm"
                loading={resuming}
                onClick={handleResume}
                aria-label={l10n.getString('settings-license-resume-aria')}
              >
                <Localized id="settings-license-resume-subscription">
                  <span>Resume subscription</span>
                </Localized>
              </Button>
            </span>
          </div>
        )}
      </div>

      {/* ── §J remediation: live over-quota assessment for the effective tier ── */}
      <OverQuotaCard />

      <ExitSurveyModal
        open={showExitSurvey}
        onClose={() => setShowExitSurvey(false)}
        onConfirm={handlePauseConfirm}
      />
    </Card>
  );
}
