import { useState, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { listLocationsScoped, setPrimaryLocationScoped, deleteLocationProfileScoped, type LocationProfile } from '@/api/locations';
import { listTerminalsScoped, type TerminalDto } from '@/api/terminals';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useContext } from 'react';
import { openUpgradePricing } from '@/utils/upgrade';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Skeleton } from '@/components/Skeleton';
import TerminalStatusPanel from './TerminalStatusPanel';
import './MultiStoreDashboardScreen.css';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
}

/** Multi-store dashboard — overview of all store profiles with terminal status and primary store designation. */
export default function MultiStoreDashboardScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  // C2.2: Pro→Premium trigger — when the Pro tier is at its 2-store cap,
  // nudge the owner toward Premium.
  const { caps } = useSubscription();
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const atProLocationCap = caps?.tier === 'pro' && (caps.locationCount ?? 0) >= 2;
  const sessionToken = rawToken || '';
  const [stores, setStores] = useState<LocationProfile[]>([]);
  const [terminals, setTerminals] = useState<TerminalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [storeData, termData] = await Promise.all([
        listLocationsScoped(sessionToken),
        listTerminalsScoped(sessionToken),
      ]);
      setStores(storeData);
      setTerminals(termData);
    } catch {
      setError(l10n.getString('multi-store-error-load'));
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const handleSetPrimary = useCallback(async (id: string) => {
    try {
      await setPrimaryLocationScoped(sessionToken, id);
      setStores((prev) =>
        prev.map((s) => ({ ...s, is_primary: s.id === id })),
      );
    } catch {
      // silently fail
    }
  }, [sessionToken]);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await deleteLocationProfileScoped(sessionToken, id);
      setStores((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // silently fail
    } finally {
      setDeletingId(null);
    }
  }, [sessionToken]);

  const activeTerminals = terminals.filter((t) => t.isActive).length;
  const onlineTerminals = terminals.filter((t) => isOnline(t.lastSeenAt)).length;

  const getTerminalCount = useCallback(
    (_storeId: string) => terminals.length,
    [terminals],
  );

  return (
    <div className="multi-store-dashboard">
      <div className="multi-store-dashboard-header">
        <Localized id="multi-store-dashboard-title">
          <h1 className="multi-store-dashboard-title">Multi-Store Dashboard</h1>
        </Localized>
      </div>

      {/* C2.2: Pro tier at its 2-store cap — "Buka toko ke-3? Upgrade ke Premium". */}
      {atProLocationCap && (
        <div className="multi-store-limit-banner" role="note">
          <span>{l10n.getString('store-limit-upgrade-premium')}</span>
          <Button variant="primary" size="sm" onClick={() => openUpgradePricing(locale, 'premium')}>
            {l10n.getString('store-limit-upgrade-premium-cta')}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="multi-store-dashboard-loading-skeleton">
          <div className="multi-store-stat-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="multi-store-stat-card">
                <Skeleton variant="block" width="3rem" height="2.5rem" />
                <Skeleton variant="text" width="6rem" />
              </div>
            ))}
          </div>
          <Skeleton variant="block" width="8rem" height="1.25rem" style={{ marginBottom: 'var(--space-4)' }} />
          <div className="multi-store-card-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} shadow="sm" padding="md" className="multi-store-card">
                <div className="multi-store-card-header">
                  <Skeleton variant="text" width="8rem" />
                </div>
                <div className="multi-store-card-body">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="multi-store-card-row">
                      <Skeleton variant="text" width="4rem" />
                      <Skeleton variant="text" width="5rem" />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : error ? (
        <Card shadow="sm">
          <div className="multi-store-dashboard-error">
            <p>{error}</p>
            <Button variant="secondary" onClick={load}><Localized id="retry">Retry</Localized></Button>
          </div>
        </Card>
      ) : (
        <>
          {/* ── Stat cards ────────────────────────────────────── */}
          <div className="multi-store-stat-grid">
            <div className="multi-store-stat-card">
              <span className="multi-store-stat-value">{stores.length}</span>
              <span className="multi-store-stat-label"><Localized id="multi-store-stat-total-stores">Total Stores</Localized></span>
            </div>
            <div className="multi-store-stat-card">
              <span className="multi-store-stat-value">{activeTerminals}</span>
              <span className="multi-store-stat-label"><Localized id="multi-store-stat-active-terminals">Active Terminals</Localized></span>
            </div>
            <div className="multi-store-stat-card">
              <span className="multi-store-stat-value">{onlineTerminals}</span>
              <span className="multi-store-stat-label"><Localized id="multi-store-stat-online-terminals">Online Terminals</Localized></span>
            </div>
            <div className="multi-store-stat-card">
              <span className="multi-store-stat-value">{terminals.length}</span>
              <span className="multi-store-stat-label"><Localized id="multi-store-stat-total-terminals">Total Terminals</Localized></span>
            </div>
          </div>

          {/* ── Store cards ───────────────────────────────────── */}
          <section aria-label={l10n.getString('multi-store-section-stores-overview')}>
            <h2 className="multi-store-section-title"><Localized id="multi-store-section-stores">Stores</Localized></h2>
            <div className="multi-store-card-grid">
              {stores.map((store) => {
                const tc = getTerminalCount(store.id);
                return (
                  <Card
                    key={store.id}
                    shadow={store.is_primary ? 'md' : 'sm'}
                    padding="md"
                    className={`multi-store-card ${store.is_primary ? 'multi-store-card--primary' : ''}`}
                    header={
                      <div className="multi-store-card-header">
                        <span className="multi-store-card-name">{store.name}</span>
                        {store.is_primary && (
                          <span className="multi-store-card-badge"><Localized id="multi-store-badge-primary">Primary</Localized></span>
                        )}
                      </div>
                    }
                    footer={
                      <div className="multi-store-card-actions">
                        {!store.is_primary && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSetPrimary(store.id)}
                              aria-label={l10n.getString('multi-store-btn-set-primary-label', { name: store.name })}
                            >
                              <Localized id="multi-store-btn-set-primary">Set as Primary</Localized>
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={deletingId === store.id}
                              onClick={() => handleDelete(store.id)}
                              aria-label={l10n.getString('multi-store-btn-delete-label', { name: store.name })}
                            >
                              <Localized id="multi-store-btn-delete">Delete</Localized>
                            </Button>
                          </>
                        )}
                      </div>
                    }
                  >
                    <div className="multi-store-card-body">
                      {store.address && (
                        <div className="multi-store-card-row">
                          <span className="multi-store-card-label"><Localized id="multi-store-label-address">Address</Localized></span>
                          <span className="multi-store-card-value">{store.address}</span>
                        </div>
                      )}
                      {store.tax_id && (
                        <div className="multi-store-card-row">
                          <span className="multi-store-card-label"><Localized id="multi-store-label-tax-id">Tax ID</Localized></span>
                          <span className="multi-store-card-value">{store.tax_id}</span>
                        </div>
                      )}
                      <div className="multi-store-card-row">
                          <span className="multi-store-card-label"><Localized id="multi-store-label-currency">Currency</Localized></span>
                        <span className="multi-store-card-value">{store.currency}</span>
                      </div>
                      <div className="multi-store-card-row">
                          <span className="multi-store-card-label"><Localized id="multi-store-label-timezone">Timezone</Localized></span>
                        <span className="multi-store-card-value">{store.timezone}</span>
                      </div>
                      <div className="multi-store-card-row">
                          <span className="multi-store-card-label"><Localized id="multi-store-label-terminals">Terminals</Localized></span>
                        <span className="multi-store-card-value">{tc}</span>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>

          {/* ── Terminal Status Panel ─────────────────────────── */}
          <section aria-label={l10n.getString('multi-store-section-terminal-status')} className="multi-store-terminal-section">
            <TerminalStatusPanel refreshTrigger={0} />
          </section>
        </>
      )}
    </div>
  );
}
