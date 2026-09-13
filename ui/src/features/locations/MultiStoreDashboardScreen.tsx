import { useState, useEffect, useCallback } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { listLocationsScoped, setPrimaryLocationScoped, deleteLocationProfileScoped, getLocationTicketPrefixScoped, setLocationTicketPrefixScoped, type LocationProfile } from '@/api/locations';
import { listTerminalsScoped, type TerminalDto } from '@/api/terminals';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useContext } from 'react';
import { openUpgradePricing } from '@/utils/upgrade';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Modal } from '@/components/Modal';
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
  const { sessionToken: rawToken, setActiveWorkspace } = useWorkspace();
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
  /** Location whose read-only details modal is open (View details). */
  const [detailsStore, setDetailsStore] = useState<LocationProfile | null>(null);
  // W7-A: ticket-prefix editor (the frozen-at-stamping surface). Lives in
  // the details modal because it edits ONE location's numbering, and the
  // modal is already scoped to that location.
  const [prefixDraft, setPrefixDraft] = useState('');
  const [prefixSaved, setPrefixSaved] = useState<string | null>(null);
  const [prefixBusy, setPrefixBusy] = useState(false);
  const [prefixError, setPrefixError] = useState<string | null>(null);

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

  // ── W7-A: ticket-prefix editor (frozen-at-stamping contract) ──────
  // The modal's open transition reads THAT location's prefix; saving
  // submits the trimmed draft and trusts the BACKEND's echo (trim +
  // uppercase) rather than patching local text — the operator must see
  // exactly what future tickets will carry.
  useEffect(() => {
    if (!detailsStore || !sessionToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const prefix = await getLocationTicketPrefixScoped(sessionToken, detailsStore.id);
        if (cancelled) return;
        setPrefixDraft(prefix ?? '');
        setPrefixSaved(null);
        setPrefixError(null);
      } catch {
        if (!cancelled) setPrefixError('multi-store-prefix-error-load');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailsStore, sessionToken]);

  const handleSavePrefix = useCallback(async () => {
    if (!detailsStore || !sessionToken) return;
    setPrefixBusy(true);
    setPrefixError(null);
    try {
      // Empty input CLEARS the prefix ('' = no prefix, tickets number bare).
      const echoed = await setLocationTicketPrefixScoped(
        sessionToken,
        detailsStore.id,
        prefixDraft.trim(),
      );
      setPrefixDraft(echoed ?? '');
      setPrefixSaved(echoed ?? '');
    } catch {
      setPrefixError('multi-store-prefix-error-save');
    } finally {
      setPrefixBusy(false);
    }
  }, [detailsStore, sessionToken, prefixDraft]);

  // ── Locations → Topology entry points (todo-global-saas-2 §"Locations
  //    and Topology navigation") ──────────────────────────────────────
  // The dashboard stays status-oriented: these actions only ROUTE. The
  // Topology Editor (settings hub, topology section) owns every profile
  // and relationship mutation — creation hands off to its Add Branch form
  // via `?create=1`, per-location configuration scopes the editor via
  // `?branch=<id>`; SettingsPage parses both off the mount-time hash and
  // hands them to the editor as mount hints. Setting the admin workspace
  // (idempotent when already active) matches the workspace tool cards'
  // deep-link navigation; when the shell is already there, AppShell's
  // hashchange sync lands the settings route and SettingsPage's own
  // listener applies the section.
  /** Configure topology for one location — opens the editor scoped to
   *  that location's graph. */
  const handleConfigureTopology = useCallback((locationId: string) => {
    window.location.hash = `#/settings/topology?branch=${encodeURIComponent(locationId)}`;
    setActiveWorkspace('admin');
  }, [setActiveWorkspace]);

  /** Begin location creation from Locations (discoverability); the
   *  editor's armed Add Branch form receives the user and owns the
   *  actual profile mutation and the workspace/terminal/KDS/warehouse/
   *  routing configuration that follows. */
  const handleAddLocation = useCallback(() => {
    window.location.hash = '#/settings/topology?create=1';
    setActiveWorkspace('admin');
  }, [setActiveWorkspace]);

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
        <Button
          variant="primary"
          size="sm"
          onClick={handleAddLocation}
          aria-label={l10n.getString('multi-store-btn-add-location-aria')}
        >
          <Localized id="multi-store-btn-add-location">Add location</Localized>
        </Button>
      </div>

      {/* C2.2: Pro tier at its 2-store cap — "Buka toko ke-3? Upgrade ke Premium". */}
      {atProLocationCap && (
        <div className="multi-store-limit-banner" role="note">
          <span>{l10n.getString('location-limit-upgrade-premium')}</span>
          <Button variant="primary" size="sm" onClick={() => openUpgradePricing(locale, 'premium')}>
            {l10n.getString('location-limit-upgrade-premium-cta')}
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
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDetailsStore(store)}
                          aria-label={l10n.getString('multi-store-btn-details-label', { name: store.name })}
                        >
                          <Localized id="multi-store-btn-details">View details</Localized>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleConfigureTopology(store.id)}
                          aria-label={l10n.getString('multi-store-btn-configure-topology-label', { name: store.name })}
                        >
                          <Localized id="multi-store-btn-configure-topology">Configure topology</Localized>
                        </Button>
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

      {/* ── View details modal — read-only location profile ──────
          Status-oriented detail surface (§"Locations and Topology
          navigation"): every field the profile carries, plus routing
          actions that hand off to their owning surfaces. The editor stays
          the owner of profile mutation; the modal only offers Configure
          topology and Delete as entry points. */}
      <Modal
        open={detailsStore !== null}
        onClose={() => setDetailsStore(null)}
        title={detailsStore?.name ?? ''}
        footer={
          detailsStore && (
            <div className="multi-store-details-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  const id = detailsStore.id;
                  setDetailsStore(null);
                  handleConfigureTopology(id);
                }}
                aria-label={l10n.getString('multi-store-btn-configure-topology-label', { name: detailsStore.name })}
              >
                <Localized id="multi-store-btn-configure-topology">Configure topology</Localized>
              </Button>
              <Button
                variant="secondary"
                onClick={() => setDetailsStore(null)}
                aria-label={l10n.getString('multi-store-details-close-aria')}
              >
                <Localized id="multi-store-details-close">Close</Localized>
              </Button>
            </div>
          )
        }
      >
        {detailsStore && (
          <div className="multi-store-details-grid">
            <div className="multi-store-card-row">
              <span className="multi-store-card-label"><Localized id="multi-store-label-address">Address</Localized></span>
              <span className="multi-store-card-value">{detailsStore.address || '—'}</span>
            </div>
            <div className="multi-store-card-row">
              <span className="multi-store-card-label"><Localized id="multi-store-label-tax-id">Tax ID</Localized></span>
              <span className="multi-store-card-value">{detailsStore.tax_id || '—'}</span>
            </div>
            <div className="multi-store-card-row">
              <span className="multi-store-card-label"><Localized id="multi-store-label-currency">Currency</Localized></span>
              <span className="multi-store-card-value">{detailsStore.currency}</span>
            </div>
            <div className="multi-store-card-row">
              <span className="multi-store-card-label"><Localized id="multi-store-label-timezone">Timezone</Localized></span>
              <span className="multi-store-card-value">{detailsStore.timezone}</span>
            </div>
            <div className="multi-store-card-row">
              <span className="multi-store-card-label"><Localized id="multi-store-label-terminals">Terminals</Localized></span>
              <span className="multi-store-card-value">{getTerminalCount(detailsStore.id)}</span>
            </div>
          </div>
        )}
        {detailsStore && (
          <section className="multi-store-prefix-editor" aria-labelledby="multi-store-prefix-title">
            <Localized id="multi-store-prefix-title">
              <h3 id="multi-store-prefix-title" className="multi-store-prefix-title">
                Ticket prefix
              </h3>
            </Localized>
            <div className="multi-store-card-row">
              <label htmlFor="multi-store-prefix-input">
                <Localized id="multi-store-prefix-label">Prefix</Localized>
              </label>
              <input
                id="multi-store-prefix-input"
                type="text"
                value={prefixDraft}
                maxLength={12}
                onChange={(e) => {
                  setPrefixDraft(e.target.value);
                  setPrefixSaved(null);
                }}
              />
            </div>
            <p className="multi-store-prefix-warning" role="note">
              <Localized id="multi-store-prefix-warning">
                The prefix is copied onto each ticket when it is stamped:
                changing it here affects only FUTURE tickets — existing ones
                keep the prefix they were stamped with.
              </Localized>
            </p>
            <p className="multi-store-prefix-hint">
              <Localized id="multi-store-prefix-hint">
                Empty = no prefix (tickets number bare). Uppercased on save;
                renders as PREFIX123.
              </Localized>
            </p>
            <div className="multi-store-prefix-actions">
              <Button
                variant="secondary"
                size="sm"
                loading={prefixBusy}
                onClick={() => void handleSavePrefix()}
                aria-label={l10n.getString('multi-store-prefix-save-aria', { name: detailsStore.name })}
              >
                <Localized id="multi-store-prefix-save">Save prefix</Localized>
              </Button>
              {prefixSaved !== null && (
                <span className="multi-store-prefix-saved" role="status">
                  <Localized
                    id="multi-store-prefix-saved"
                    vars={{ prefix: prefixSaved === '' ? '—' : prefixSaved }}
                  >
                    {'Saved. Future tickets: '}
                    {prefixSaved === '' ? '—' : prefixSaved}
                    {'123'}
                  </Localized>
                </span>
              )}
              {prefixError && (
                <span className="multi-store-prefix-error" role="alert">
                  {l10n.getString(prefixError)}
                </span>
              )}
            </div>
          </section>
        )}
      </Modal>
    </div>
  );
}
