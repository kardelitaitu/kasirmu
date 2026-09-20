import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type Labels } from '../i18n/labels';
import { pricingFor } from '../content/pricing';
import { clearSession, getSessionEmail, isPaddleConfigured, isPlaceholderPriceId, openPaddleCheckout } from './paddle';
import { openMidtransCheckout } from './midtrans';
import { type Region, getRegion, getExplicitRegion, setRegion } from '../lib/region';
import { licenseApiUrl } from '../lib/runtime-config';
import { getSessionToken } from '../lib/session';
import AccountProfile from './account/AccountProfile';
import AccountLicense from './account/AccountLicense';
import AccountQuickActions from './account/AccountQuickActions';
import AccountDevices, { type Device } from './account/AccountDevices';
import AccountBilling from './account/AccountBilling';
import AccountPassword, { type PasswordMsg } from './account/AccountPassword';
import AccountSignInMethods, { type SignInMethod } from './account/AccountSignInMethods';
import { PASSWORD_FIELD_LABELS } from './PasswordField';
import { PASSWORD_STRENGTH_LABELS } from './PasswordStrength';
import AccountRegion from './account/AccountRegion';
import AccountSubscription from './account/AccountSubscription';

/**
 * Account dashboard (website-plan.md §8/§11). Reads the session token from
 * sessionStorage (set by AuthForm) and fetches /api/v1/web/me from the
 * license server. Shows the license + subscription state; when there is no
 * active subscription yet it renders the subscribe buttons, which open the
 * Paddle checkout prefilled with the account email (register-first flow —
 * the account must exist before payment). Graceful in every failure mode:
 * no token, API unset, server error.
 *
 * The render is composed from the presentational sections in ./account/*
 * (profile, license, quick actions, devices, billing, password, region,
 * subscription). This file owns the state + data flow; the sections are
 * deliberately stateless so they stay easy to test in isolation.
 *
 * ## Register-first custom_data contract (ADR #23 Deviation 2)
 *
 * Both the subscribe section and the bundle upgrade card open the Paddle
 * checkout via `openPaddleCheckout(priceId, email, onClosed, bundle?)`.
 * The checkout embeds `custom_data` so the webhook can attach the
 * subscription to the correct tenant:
 *
 * - `custom_data.email` — the buyer's account email. **Required.** The
 *   webhook upserts the tenant by this value (`resolvePaddleEmail`).
 * - `custom_data.bundle` — optional C3.2 vertical bundle id
 *   (e.g. `"restaurant_starter"`). Cross-checked against the price map;
 *   never trusted alone.
 * - `custom_data.phone` — may ride along when Paddle collects it;
 *   backfilled onto the tenant when non-empty.
 *
 * The signup vertical is **not** carried — trial segmentation is a
 * desktop-activation concern, not a billing one.
 */

// Re-export the pure helpers so the property tests (and any consumer that
// imports them from AccountView) keep working after the split.
import { statusLabel, statusPillClass, fmtDate, daysUntil, renewsLabel } from './account/accountShared';
export { statusLabel, statusPillClass, fmtDate, daysUntil, renewsLabel };

interface MeResponse {
  tenant?: {
    email: string;
    emailVerified: boolean;
    status: string;
  };
  license?: {
    key: string;
    tierKey: string;
    status: string;
    expiresAt?: string;
  };
  subscription?: {
    tierKey: string;
    status: string;
    startsAt?: string;
    expiresAt?: string;
    graceUntil?: string;
    /** Vertical-bundle id (C3.2) this subscription was purchased with. */
    bundleId?: string;
  };
}

/**
 * Strings this island reads — itself and every section in `./account/*`.
 * `account.astro` turns the list into the `labels` prop with `labelMap`, so the
 * browser gets these strings in the document instead of both locale dictionaries
 * in the JS bundle; `src/__tests__/island-label-coverage.test.ts` keeps the list
 * honest.
 */
export const ACCOUNT_LABELS = [
  'account.activationGuide',
  'account.billingInvoices',
  'account.billingInvoicesHint',
  'account.bundleUpgrade',
  'account.bundleUpgradeHint',
  'account.checkingSubscription',
  'account.checkoutUnavailable',
  'account.contactSupport',
  'account.copied',
  'account.copyKey',
  'account.devices',
  'account.devicesHint',
  'account.downloadApp',
  'account.emailVerified',
  'account.error',
  'account.expires',
  'account.grace',
  'account.invoiceNote',
  'account.invoiceSubject',
  'account.license',
  'account.licenseKey',
  'account.loading',
  'account.logout',
  'account.noSubscription',
  'account.notConfigured',
  'account.notSignedIn',
  'account.notVerified',
  'account.password',
  'account.passwordError',
  'account.passwordHelp',
  'account.passwordPlaceholder',
  'account.passwordSave',
  'account.passwordSaved',
  'account.providerGoogle',
  'account.quickActions',
  'account.region',
  'account.regionHint',
  'account.regionSaved',
  'account.renewHint',
  'account.renewLink',
  'account.renewsInDay',
  'account.renewsInDays',
  'account.revokeDevice',
  'account.signIn',
  'account.signInMethods',
  'account.signInMethodsAlwaysEmail',
  'account.signInMethodsEmpty',
  'account.signInMethodsHint',
  'account.starts',
  'account.status',
  'account.statusActive',
  'account.statusExpired',
  'account.statusGracePeriod',
  'account.statusPaused',
  'account.statusRevoked',
  'account.statusUnused',
  'account.subscribe',
  'account.subscription',
  'account.subscriptionPending',
  'account.terminalCount',
  'account.terminalCountLive',
  'account.terminalSlots',
  'account.terminalUnlimited',
  'account.tier',
  'account.unbindHint',
  'account.unlink',
  'account.unlinkError',
  'account.unlinking',
  'account.verified',
  'account.viewReceipts',
  'checkout.error',
  'signup.regionGlobal',
  'signup.regionIndonesia',
  // The dashboard's password section renders these two directly.
  ...PASSWORD_FIELD_LABELS,
  ...PASSWORD_STRENGTH_LABELS,
] as const;

interface Props {
  locale: string;
  /** Strings this island reads; see `ACCOUNT_LABELS`. */
  labels: Labels;
}

export default function AccountView({ locale, labels }: Props) {
  // Read API at component level so window.__OZ_CONFIG__ is available after hydration
  const API = licenseApiUrl();
  const [state, setState] = useState<'loading' | 'anon' | 'error' | 'ready'>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subscribeError, setSubscribeError] = useState(false);
  // Post-checkout refresh: 'checking' polls /me after a completed purchase;
  // 'pending' means the webhook hasn't provisioned yet after the poll window.
  const [refreshState, setRefreshState] = useState<'idle' | 'checking' | 'pending'>('idle');
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Fetch /me once; returns the payload, or null when signed out (token cleared). */
  const fetchMe = useCallback(async (): Promise<MeResponse | null> => {
    const token = await getSessionToken();
    if (!token || !API) return null;
    const res = await fetch(`${API}/api/v1/web/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Expired/revoked session — clear the stored token AND the cached
      // email; caller shows anon.
      clearSession();
      return null;
    }
    if (!res.ok) throw new Error('me failed');
    return (await res.json()) as MeResponse;
  }, []);

  /** Fetch the tenant's registered devices (best-effort; null on any error). */
  const fetchDevices = useCallback(async (): Promise<Device[] | null> => {
    const token = await getSessionToken();
    if (!token || !API) return null;
    try {
      const res = await fetch(`${API}/api/v1/web/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { devices?: Device[] };
      return body.devices ?? [];
    } catch {
      return null;
    }
  }, []);

  /** Fetch the tenant's linked sign-in methods (best-effort; null on any error). */
  const fetchIdentities = useCallback(async (): Promise<SignInMethod[] | null> => {
    const token = await getSessionToken();
    if (!token || !API) return null;
    try {
      const res = await fetch(`${API}/api/v1/web/identities`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { identities?: SignInMethod[] };
      return body.identities ?? [];
    } catch {
      return null;
    }
  }, []);

  // Password state: the optional login credential managed via set-password.
  const [pw, setPw] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwMsg, setPwMsg] = useState<PasswordMsg>('idle');
  const [pwSaving, setPwSaving] = useState(false);
  // Region state
  const [region, setRegionState] = useState<Region>(() => getRegion());
  // Payment routing follows the saved region (ADR #39 D1) exactly like the
  // pricing-page CheckoutButton: Indonesia → Midtrans Snap, everything else
  // → Paddle. Falls back to the locale only when region is unset.
  const [useMidtrans, setUseMidtrans] = useState<boolean>(() => {
    const r = getExplicitRegion();
    return r === 'id' || (!r && locale === 'id');
  });
  useEffect(() => {
    const r = getExplicitRegion();
    setUseMidtrans(r === 'id' || (!r && locale === 'id'));
  }, [region, locale]);
  // Device revoke state: record id currently being revoked, plus the last
  // failure message (shown inline on the device row).
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Linked sign-in methods (ADR #54). null means "not loaded yet", which is why the
  // section renders nothing rather than an empty state while the fetch is in flight.
  const [identities, setIdentities] = useState<SignInMethod[] | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!API) {
      setState('error');
      return;
    }
    // P2: no synchronous sessionStorage gate here. fetchMe resolves the
    // token cookie-first via getSessionToken (the Worker's /__oz/session
    // httpOnly cookie, sessionStorage only as fallback) and returns null
    // when neither exists — so a session that lives ONLY in the httpOnly
    // cookie (sessionStorage cleared, another tab, or an R1-only login)
    // still loads the dashboard instead of falsely showing "anon".
    fetchMe()
      .then((data) => {
        if (!mountedRef.current) return;
        if (data) {
          setMe(data);
          setState('ready');
        } else {
          setState('anon');
        }
      })
      .catch(() => {
        if (mountedRef.current) setState('error');
      });
    // Best-effort device list — a failure here must not fail the dashboard.
    void fetchDevices()
      .then((list) => {
        if (mountedRef.current) setDevices(list);
      })
      .catch(() => {
        if (mountedRef.current) setDevices(null);
      });
    // Same contract for the linked sign-in methods.
    void fetchIdentities()
      .then((list) => {
        if (mountedRef.current) setIdentities(list);
      })
      .catch(() => {
        if (mountedRef.current) setIdentities(null);
      });
  }, [fetchMe, fetchDevices, fetchIdentities]);

  const savePassword = async (password: string) => {
    setPwMsg('idle');
    setPwSaving(true);
    try {
      const token = await getSessionToken();
      if (!token) throw new Error('no session');
      const res = await fetch(`${API}/api/v1/web/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, password_confirm: pwConfirm }),
      });
      if (!res.ok) throw new Error('set-password failed');
      setPw('');
      setPwConfirm('');
      setPwMsg('saved');
    } catch {
      setPwMsg('error');
    } finally {
      setPwSaving(false);
    }
  };

  /**
   * Open the checkout overlay for the given tier/bundle.
   *
   * Register-first custom_data contract (ADR #23 Deviation 2):
   * - `custom_data.email` — buyer's account email (required; webhook upserts
   *   the tenant by it)
   * - `custom_data.bundle` — optional C3.2 bundle id (cross-checked against
   *   the price map; never trusted alone)
   * - `custom_data.phone` — may ride along; backfilled onto tenant
   *
   * For Midtrans (id-locale), the equivalent fields are custom_field1–4
   * in the Snap request (see midtrans.ts).
   */
  const subscribe = async (priceId: string, tierKey: string, bundle?: string) => {
    setSubscribing(tierKey);
    setSubscribeError(false);
    // Indonesian market bills through Midtrans Snap (ADR #39 D1); every
    // other region through Paddle. useMidtrans follows the saved region
    // preference (see state init), same as the pricing-page CheckoutButton.
    try {
      if (useMidtrans) {
        // The bundle (C3.2) rides the snap request (custom_field4) so the
        // webhook mints the bundle-widened quota block.
        await openMidtransCheckout(tierKey, 'yearly', (completed) => pollAfterCheckout(completed), bundle);
        return;
      }
      // P5: reuse the email already loaded on mount (me.tenant.email) instead
      // of triggering a second /me fetch via getSessionEmail. The subscribe
      // button only renders after state === 'ready', so me is live here.
      const email = me?.tenant?.email ?? (await getSessionEmail());
      if (!email) throw new Error('no session email');
      // After the overlay closes, refresh /me so a completed purchase shows
      // the subscription without a manual reload. The webhook provisions
      // asynchronously, so poll for it (up to ~20s) instead of a single fetch.
      await openPaddleCheckout(priceId, email, (completed) => pollAfterCheckout(completed), bundle);
    } catch (err) {
      console.error('checkout open failed', err);
      setSubscribeError(true);
    } finally {
      setSubscribing(null);
    }
  };

  /** Poll /me after a completed checkout until the webhook provisions. */
  const pollAfterCheckout = (completed: boolean) => {
    if (!completed) return;
    if (!mountedRef.current) return;
    setRefreshState('checking');
    void (async () => {
      let found = false;
      for (let i = 0; i < 8 && !found; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        if (!mountedRef.current) return;
        try {
          const data = await fetchMe();
          if (data) {
            setMe(data);
            setState('ready');
            found = Boolean(data.subscription);
          }
        } catch {
          // Transient network error — keep polling.
        }
      }
      if (mountedRef.current) setRefreshState(found ? 'idle' : 'pending');
    })();
  };

  /** Revoke a device via POST /web/devices/{id}/revoke, then refresh the list. */
  const revokeDevice = async (device: Device) => {
    if (!device.id || !API) return;
    const token = await getSessionToken();
    if (!token) return;
    setRevokingId(device.id);
    setRevokeError(null);
    try {
      const res = await fetch(`${API}/api/v1/web/devices/${encodeURIComponent(device.id)}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`revoke failed (${res.status})`);
      // Mark this device revoked in local state immediately; refresh the
      // full list so any server-side ordering is preserved. If the refresh
      // fails (null), keep the existing list and just stamp the revoked
      // device — the list must not collapse to the fallback hint.
      const fresh = await fetchDevices();
      if (mountedRef.current) {
        setDevices((prev) => {
          const list = fresh ?? prev ?? [];
          return list.map((d) => (d.id === device.id ? { ...d, revoked_at: d.revoked_at ?? new Date().toISOString() } : d));
        });
      }
    } catch (err) {
      if (mountedRef.current) setRevokeError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setRevokingId(null);
    }
  };

  /** Unlink a sign-in method via DELETE /web/identities/{id}, then refresh. */
  const unlinkIdentity = async (method: SignInMethod) => {
    if (!method.id || !API) return;
    const token = await getSessionToken();
    if (!token) return;
    setUnlinkingId(method.id);
    setUnlinkError(null);
    try {
      const res = await fetch(`${API}/api/v1/web/identities/${encodeURIComponent(method.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      // Drop the row locally, then reconcile with the server list. If the
      // refresh fails (null) the removal still stands — the DELETE succeeded.
      const fresh = await fetchIdentities();
      if (mountedRef.current) {
        setIdentities((prev) => (fresh ?? (prev ?? []).filter((m) => m.id !== method.id)));
      }
    } catch {
      if (mountedRef.current) setUnlinkError(t(labels, 'account.unlinkError'));
    } finally {
      if (mountedRef.current) setUnlinkingId(null);
    }
  };

  /** Sign out: best-effort server logout, clear cookie + local session, redirect. */
  const handleLogout = async () => {
    const token = await getSessionToken();
    if (API && token) {
      try {
        await fetch(`${API}/api/v1/web/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore network errors — logout is idempotent server-side.
      }
    }
    // R1: clear the httpOnly cookie via the Worker (redirect: manual so we
    // don't follow its 302 to the login page — we redirect ourselves to the
    // same-origin home). No-op when the Worker is absent (local dev).
    try {
      await fetch('/__oz/logout', { method: 'GET', redirect: 'manual' });
    } catch {
      // No Worker / network error — sessionStorage clear below still signs out.
    }
    clearSession();
    window.location.href = `/${locale}`;
  };

  if (state === 'loading') {
    return (
      <div className="space-y-4 animate-pulse" role="status" aria-label={t(labels, 'account.loading')}>
        <p className="sr-only">{t(labels, 'account.loading')}</p>
        <div className="rounded-xl border border-ink/10 bg-surface/40 p-6">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-full bg-ink/10" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-48 rounded bg-ink/10" />
              <div className="h-3 w-32 rounded bg-ink/10" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-surface/40 p-6">
          <div className="h-4 w-24 rounded bg-ink/10 mb-4" />
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="h-3 w-full rounded bg-ink/10" />
            <div className="h-3 w-full rounded bg-ink/10" />
            <div className="h-3 w-full rounded bg-ink/10" />
            <div className="h-3 w-full rounded bg-ink/10" />
          </div>
        </div>
        <div className="rounded-xl border border-ink/10 bg-surface/40 p-6">
          <div className="h-4 w-28 rounded bg-ink/10 mb-4" />
          <div className="grid grid-cols-3 gap-3">
            <div className="h-20 rounded-lg bg-ink/10" />
            <div className="h-20 rounded-lg bg-ink/10" />
            <div className="h-20 rounded-lg bg-ink/10" />
          </div>
        </div>
      </div>
    );
  }

  if (state === 'anon') {
    return (
      <div className="rounded-xl border border-ink/10 bg-surface/40 p-6 text-center">
        <p className="text-muted">{t(labels, 'account.notSignedIn')}</p>
        <a
          href={`/${locale}/login`}
          className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:opacity-90"
        >
          {t(labels, 'account.signIn')}
        </a>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <p className="rounded-md border border-ink/10 p-4 text-sm text-muted">
        {API ? t(labels, 'account.error') : t(labels, 'account.notConfigured')}
      </p>
    );
  }

  const { tenant, license, subscription } = me ?? {};
  // Subscribe options from the locale's pricing content: the three paid tiers
  // (plus/pro/premium), billed at the yearly (default) rate. Tiers whose
  // Paddle price id is still a placeholder (subscription-tiers.md — six real
  // prices not yet catalogued) are excluded so the button never opens a
  // dead checkout; free/enterprise have no price id at all.
  // WIP: all Paddle price ids are currently pri_placeholder_* (see
  // pricing/en.ts). For the id locale (Midtrans) the filter is bypassed,
  // so subscribe buttons render. For other locales all plans are filtered
  // out and the section shows "checkout unavailable".
  // The id market bills through Midtrans (fixed Rp from the server's
  // MIDTRANS_PRICE_TIERS map), so Paddle price ids don't gate it; other
  // markets need a real, non-placeholder Paddle price. useMidtrans is the
  // region-derived state (see state init) — do not redeclare it here.
  // The pricing source follows the payment provider: when useMidtrans is true
  // the checkout goes through Midtrans (IDR) so the displayed prices must
  // match — use the id pricing content, not the URL locale.
  const subscribable = (pricingFor(useMidtrans ? 'id' : locale) ?? [])
    .filter((tier) => tier.tierKey === 'plus' || tier.tierKey === 'pro' || tier.tierKey === 'premium')
    .map((tier) => {
      const yearly = tier.prices.yearly;
      return { tierKey: tier.tierKey, name: tier.name, price: yearly.price, period: yearly.period, priceId: yearly.priceId ?? '' };
    })
    .filter((plan) => (useMidtrans ? true : plan.priceId && !isPlaceholderPriceId(plan.priceId)));

  // Restaurant Starter bundle (C3.2, subscription-tiers.md §5): the Plus
  // add-on, offered as an in-app upgrade to existing Plus subscribers who
  // don't own it yet. Gated on the same checkout availability as the
  // subscribe section — Midtrans needs the license API (the server's
  // MIDTRANS_PRICE_TIERS carries the bundle amount); Paddle needs a real,
  // non-placeholder bundle price id plus the client token. Until the real
  // catalog lands the placeholder ids keep the card hidden, exactly like
  // the subscribe section hides placeholder plans.
  // WIP: bundle checkout needs a real Paddle bundle price id (currently
  // pri_placeholder_plus_bundle_*) — the card stays hidden until then.
  // Pricing source follows the payment provider, same as the subscribe
  // section: Midtrans (useMidtrans) bills in IDR, so show the id pricing.
  const plusBundle = (pricingFor(useMidtrans ? 'id' : locale) ?? []).find((tier) => tier.tierKey === 'plus')?.bundle;
  const bundleYearly = plusBundle?.prices.yearly;
  const bundleCheckoutAvailable =
    Boolean(plusBundle) &&
    (useMidtrans
      ? Boolean(licenseApiUrl())
      : Boolean(bundleYearly?.priceId) && !isPlaceholderPriceId(bundleYearly?.priceId) && isPaddleConfigured());

  // The effective tier, and it is never blank: an active subscription wins, then the tier
  // the license was minted with, and a brand-new account is on `free`. Both consumers below
  // need the same answer -- the visible tier and the device-limit checks.
  const effectiveTier = subscription?.tierKey || license?.tierKey || 'free';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {tenant && (
        <AccountProfile labels={labels} tenant={tenant} onLogout={() => void handleLogout()} />
      )}

      {tenant && (
        <AccountLicense locale={locale} labels={labels} tenantStatus={tenant.status} tierKey={effectiveTier} license={license} />
      )}

      {/* Quick Action Navigation Grid */}
      {tenant && <AccountQuickActions locale={locale} labels={labels} />}

      {/* Device / Terminal Management */}
      {tenant && (
        <AccountDevices
          locale={locale}
          labels={labels}
          devices={devices}
          licenseTierKey={effectiveTier}
          revokingId={revokingId}
          revokeError={revokeError}
          onRevoke={(d) => void revokeDevice(d)}
        />
      )}

      {/* Linked sign-in methods (ADR #54) */}
      {tenant && (
        <AccountSignInMethods
          labels={labels}
          identities={identities}
          unlinkingId={unlinkingId}
          unlinkError={unlinkError}
          onUnlink={(m) => void unlinkIdentity(m)}
        />
      )}

      {/* Billing & Tax Invoices */}
      {tenant && <AccountBilling labels={labels} tenantEmail={tenant.email} />}

      {tenant && (
        <AccountPassword
          labels={labels}
          email={tenant.email}
          pw={pw}
          pwConfirm={pwConfirm}
          msg={pwMsg}
          saving={pwSaving}
          onPwChange={(v) => {
            setPw(v);
            if (pwMsg !== 'idle') setPwMsg('idle');
          }}
          onPwConfirmChange={(v) => {
            setPwConfirm(v);
            if (pwMsg !== 'idle') setPwMsg('idle');
          }}
          onSave={(password) => void savePassword(password)}
        />
      )}

      {/* Region selector */}
      {tenant && (
        <AccountRegion
          labels={labels}
          region={region}
          onRegionChange={(next) => {
            setRegionState(next);
            setRegion(next);
          }}
        />
      )}

      <AccountSubscription
        locale={locale}
        labels={labels}
        subscription={subscription ?? null}
        subscribable={subscribable}
        plusBundle={plusBundle}
        bundleYearly={bundleYearly}
        bundleCheckoutAvailable={bundleCheckoutAvailable}
        useMidtrans={useMidtrans}
        subscribing={subscribing}
        subscribeError={subscribeError}
        refreshState={refreshState}
        onSubscribe={(priceId, tierKey, bundle) => void subscribe(priceId, tierKey, bundle)}
      />
    </div>
  );
}
