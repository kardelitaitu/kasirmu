import { t, type Labels } from '../../i18n/labels';
import { licenseApiUrl } from '../../lib/runtime-config';
import { isPaddleConfigured } from '../paddle';
import { fmtDate, statusLabel, statusPillClass, daysUntil, renewsLabel } from './accountShared';

/**
 * Subscription section (active) or subscribe section (none) + bundle
 * upgrade card + checkout feedback. Combines three states the original
 * AccountView rendered together because they share the same `subscribe`
 * handler and `subscribing`/`refreshState` state.
 */

interface Subscription {
  tierKey: string;
  status: string;
  startsAt?: string;
  expiresAt?: string;
  graceUntil?: string;
  bundleId?: string;
}

/** A subscribable plan derived from pricing content. */
interface SubscribablePlan {
  tierKey: string;
  name: string;
  price: string;
  period: string;
  priceId: string;
}

interface BundleInfo {
  label: string;
  note: string;
  id: string;
  prices: { yearly: { price: string; period: string; priceId?: string } };
}

interface Props {
  locale: string;
  /** Strings this section reads; AccountView passes its own map. */
  labels: Labels;
  subscription: Subscription | null;
  subscribable: SubscribablePlan[];
  /** The Plus bundle data (C3.2), undefined when unavailable. */
  plusBundle?: BundleInfo;
  bundleYearly?: { price: string; period: string; priceId?: string };
  bundleCheckoutAvailable: boolean;
  useMidtrans: boolean;
  subscribing: string | null;
  subscribeError: boolean;
  refreshState: 'idle' | 'checking' | 'pending';
  onSubscribe: (priceId: string, tierKey: string, bundle?: string) => void;
}

export default function AccountSubscription({
  locale, labels, subscription, subscribable, plusBundle, bundleYearly,
  bundleCheckoutAvailable, useMidtrans, subscribing, subscribeError,
  refreshState, onSubscribe,
}: Props) {
  return (
    <>
      {subscription ? (
        <section
          className="rounded-xl border border-ink/10 bg-surface/40 p-6 shadow-sm"
          aria-label={t(labels, 'account.subscription')}
        >
          <h2 className="text-lg font-semibold">{t(labels, 'account.subscription')}</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{t(labels, 'account.tier')}</dt>
              <dd className="capitalize">{subscription.tierKey}</dd>
            </div>
            <div>
              <dt className="text-muted">{t(labels, 'account.status')}</dt>
              <dd className="capitalize">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillClass(subscription.status)}`}>
                  {statusLabel(labels, subscription.status)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t(labels, 'account.starts')}</dt>
              <dd>{fmtDate(subscription.startsAt, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t(labels, 'account.expires')}</dt>
              <dd className="flex items-center gap-2">
                <span>{fmtDate(subscription.expiresAt, locale)}</span>
                {renderRenewBadge(labels, subscription.status, subscription.expiresAt)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t(labels, 'account.grace')}</dt>
              <dd>{fmtDate(subscription.graceUntil, locale)}</dd>
            </div>
          </dl>
          {subscription.status !== 'active' && (
            <p className="mt-4 text-sm text-muted">
              {t(labels, 'account.renewHint')}{' '}
              <a href={`/${locale}/pricing`} className="text-link underline">
                {t(labels, 'account.renewLink')}
              </a>
            </p>
          )}
          {/* In-app bundle upgrade (C3.2): existing Plus subscribers without
              the bundle get the Restaurant Starter add-on right here. The
              checkout carries bundle=restaurant_starter so the webhook
              mints the kds-widened quota block (Midtrans custom_field4 /
              Paddle custom_data.bundle). Hidden once bundleId is set. */}
          {subscription.tierKey === 'plus' && !subscription.bundleId && plusBundle && bundleCheckoutAvailable && (
            <div className="mt-5 rounded-lg border border-accent/40 p-4" data-testid="account-bundle-upgrade">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold">{plusBundle.label}</p>
                <p className="text-sm text-muted">
                  {bundleYearly?.price}
                  {bundleYearly?.period && <span> {bundleYearly.period}</span>}
                </p>
              </div>
              <p className="mt-1 text-sm text-muted">{plusBundle.note}</p>
              <p className="mt-2 text-sm text-muted">{t(labels, 'account.bundleUpgradeHint')}</p>
              <button
                type="button"
                onClick={() => void onSubscribe(bundleYearly?.priceId ?? '', 'plus', plusBundle.id)}
                disabled={subscribing !== null}
                className="mt-3 block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-60"
              >
                {subscribing === 'plus' ? '…' : t(labels, 'account.bundleUpgrade')}
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-accent/40 bg-surface/40 p-6 shadow-sm" aria-label={t(labels, 'account.subscribe')}>
          <h2 className="text-lg font-semibold">{t(labels, 'account.subscribe')}</h2>
          <p className="mt-1 text-sm text-muted">{t(labels, 'account.noSubscription')}</p>
          {(useMidtrans ? Boolean(licenseApiUrl()) : isPaddleConfigured()) && subscribable.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {subscribable.map((plan) => (
                <div key={plan.tierKey} className="rounded-lg border border-ink/10 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">{plan.name}</span>
                    <span className="text-sm text-muted">
                      {plan.price}
                      {plan.period && <span> {plan.period}</span>}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onSubscribe(plan.priceId, plan.tierKey)}
                    disabled={subscribing !== null}
                    className="mt-3 block w-full rounded-md bg-accent px-4 py-2.5 text-center text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:opacity-60"
                  >
                    {subscribing === plan.tierKey ? '…' : t(labels, 'account.subscribe')}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted" role="status">
              {t(labels, 'account.checkoutUnavailable')}
            </p>
          )}
        </section>
      )}

      {/* Checkout feedback shared by the subscribe section AND the bundle
          upgrade card (a Plus subscriber's bundle purchase also polls /me). */}
      {subscribeError && (
        <p className="text-sm text-danger" role="alert">
          {t(labels, 'checkout.error')}
        </p>
      )}
      {refreshState === 'checking' && (
        <p className="text-sm text-muted" role="status">
          {t(labels, 'account.checkingSubscription')}
        </p>
      )}
      {refreshState === 'pending' && (
        <p className="text-sm text-muted" role="status">
          {t(labels, 'account.subscriptionPending')}
        </p>
      )}
    </>
  );
}

/** Renewal countdown pill for an active subscription, color-coded by urgency. */
function renderRenewBadge(labels: Labels, status: string | undefined, expiresAt: string | undefined) {
  if (status !== 'active' || !expiresAt) return null;
  const d = daysUntil(expiresAt);
  // A negative/past countdown is meaningless ("Renews in -3 days") — the
  // server can report status=active while the expiry has already lapsed
  // (clock skew, grace-period data). Hide the badge rather than show a
  // nonsensical countdown.
  if (d === null || d < 0) return null;
  const cls = d < 7 ? 'bg-danger/15 text-danger' : d < 30 ? 'bg-warning/15 text-warning' : 'bg-ink/10 text-muted';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{renewsLabel(labels, d)}</span>;
}