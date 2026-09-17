import { useState, useCallback, useEffect, useMemo, Fragment } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { EmptyState, requiredLocalized } from '@/components';
import { NoLoyaltyIcon } from '@/components/EmptyStateIllustrations';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import TierLockedFeature from '@/components/TierLockedFeature';
import {
  listLoyaltyAccounts,
  listLoyaltyTiers,
  updateLoyaltyTier,
  type LoyaltyAccountWithDetails,
  type LoyaltyTier,
} from '@/api/loyalty';
import { listCustomersScoped, type CustomerDto } from '@/api/customers';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { l10nErrorMessage } from '@/utils/app-error';
import { contrastFg } from '@/utils/color';
import { millionthsToDecimalString, parseMinorUnits } from '@/types/domain';
import './LoyaltyManagementScreen.css';

/** Short readable date in the active locale (guards invalid ISO strings). */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale);
}

interface TierFormData {
  name: string;
  min_points: string;
  points_per_unit: string;
  earn_multiplier: string;
  colour: string;
}

/** Loyalty management screen — view loyalty accounts, manage tiers, points configuration, and earn multipliers. */
export default function LoyaltyManagementScreen() {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();
  // C2.2: Loyalty is a Premium+ feature — caps arrive from the subscription
  // context and gate the screen below.
  const { caps } = useSubscription();
  // Numbers/dates follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const [accounts, setAccounts] = useState<LoyaltyAccountWithDetails[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [tiers, setTiers] = useState<LoyaltyTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierTab, setTierTab] = useState(false);

  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState<TierFormData>({
    name: '', min_points: '', points_per_unit: '', earn_multiplier: '', colour: '',
  });
  const [savingTier, setSavingTier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Map customer ids → names once per customers change, not on every render.
  const customerMap = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  );

  const load = useCallback(async () => {
    if (!sessionToken) {
      // Loyalty data is store-scoped; never invoke a scoped command with an
      // empty token while the workspace session is still being created.
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [accs, custs, t] = await Promise.all([
        listLoyaltyAccounts(sessionToken),
        listCustomersScoped(sessionToken),
        listLoyaltyTiers(sessionToken),
      ]);
      setAccounts(accs);
      setCustomers(custs);
      setTiers(t);
    } catch (err) {
      setLoadError(l10nErrorMessage(err, l10n, 'loyalty-load-error'));
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openEditTier = useCallback((tier: LoyaltyTier) => {
    setTierForm({
      name: tier.name,
      min_points: String(tier.min_points),
      points_per_unit: String(tier.points_per_unit),
      // LOYALTY-01: render the stored millionths as a plain decimal —
      // never String(f64), which could surface representation artifacts.
      earn_multiplier: millionthsToDecimalString(tier.earn_multiplier_millionths),
      colour: tier.colour,
    });
    setEditingTier(tier.id);
    setError(null);
  }, []);

  const handleSaveTier = useCallback(async () => {
    if (!editingTier || !sessionToken) return;
    // min_points / points_per_unit are integers — reject empties and decimals
    // (parseInt would silently truncate "10.5" → 10 and "" → NaN → 0).
    const rawMin = tierForm.min_points.trim();
    const rawPpu = tierForm.points_per_unit.trim();
    const minPts = Number(rawMin);
    const ppu = Number(rawPpu);
    // LOYALTY-01: the multiplier goes on the wire as fixed-point
    // millionths (scale 6), parsed exactly — a float 1.4 here is the bug.
    const multMillionths = parseMinorUnits(tierForm.earn_multiplier.trim(), 6);
    const validColour = /^#[0-9a-fA-F]{6}$/.test(tierForm.colour);
    if (
      rawMin === ''
      || !Number.isInteger(minPts)
      || minPts < 0
      || rawPpu === ''
      || !Number.isInteger(ppu)
      || ppu <= 0
      || multMillionths === null
      || multMillionths <= 0
      || !validColour
      || !tierForm.name.trim()
    ) {
      setError(l10n.getString('loyalty-validation-error'));
      return;
    }
    setSavingTier(true);
    setError(null);
    try {
      const updated = await updateLoyaltyTier(sessionToken, {
        id: editingTier,
        name: tierForm.name.trim(),
        min_points: minPts,
        points_per_unit: ppu,
        earn_multiplier_millionths: multMillionths,
        colour: tierForm.colour,
        sort_order: tiers.find((t) => t.id === editingTier)?.sort_order ?? 0,
        created_at: tiers.find((t) => t.id === editingTier)?.created_at ?? '',
      });
      setTiers((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditingTier(null);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'loyalty-save-tier-error'));
    } finally {
      setSavingTier(false);
    }
  }, [editingTier, tierForm, tiers, l10n, sessionToken]);

  // C2.2: Loyalty module teaser (Pro→Premium trigger) — render a locked
  // screen with an animated preview + upgrade CTA instead of the live UI.
  if (caps && !caps.supportsLoyalty) {
    return (
      <div className="loyalty-mgmt">
        <TierLockedFeature
          titleKey="loyalty-upgrade-required"
          messageKey="loyalty-upgrade-message"
          ctaKey="loyalty-upgrade-cta"
          target="premium"
        >
          <div className="loyalty-locked-preview" aria-hidden="true">
            <span className="loyalty-locked-badge">★</span>
            <span className="loyalty-locked-bar" />
            <span className="loyalty-locked-bar" />
            <span className="loyalty-locked-bar" />
          </div>
        </TierLockedFeature>
      </div>
    );
  }

  return (
    <div className="loyalty-mgmt">
      <div className="loyalty-mgmt-header">
        <Localized id="loyalty-title">
          <h1 className="loyalty-mgmt-title">Loyalty</h1>
        </Localized>
        <div className="loyalty-mgmt-tabs">
          <Button variant={tierTab ? 'ghost' : 'primary'} onClick={() => setTierTab(false)}>
            <Localized id="loyalty-accounts">Accounts</Localized>
          </Button>
          <Button variant={tierTab ? 'primary' : 'ghost'} onClick={() => setTierTab(true)}>
            <Localized id="loyalty-tiers">Tiers</Localized>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="loyalty-mgmt-loading-skeleton" aria-hidden="true">
          <div className="loyalty-mgmt-header">
            <Skeleton variant="block" width="6rem" height="1.75rem" />
            <div className="loyalty-mgmt-tabs">
              <Skeleton variant="block" width="5rem" height="2.25rem" />
              <Skeleton variant="block" width="4rem" height="2.25rem" />
            </div>
          </div>
          <div className="loyalty-table-wrap">
            <table className="loyalty-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Customer', 'Tier', 'Points', 'Lifetime Points', 'Next Tier', 'Points to Next', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 6 ? '5rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="6rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="3rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="4rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="4rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="3rem" height="0.75rem" /></td>
                    <td><Skeleton variant="circle" width="1.25rem" height="1.25rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : loadError ? (
        <Card shadow="sm">
          <div className="loyalty-mgmt-error loyalty-mgmt-load-error" role="alert">
            <span>{loadError}</span>
            <Button variant="ghost" onClick={load}>
              <Localized id="retry">Retry</Localized>
            </Button>
          </div>
        </Card>
      ) : tierTab ? (
        <div className="loyalty-tiers-section">
          <div className="loyalty-tiers-grid">
            {tiers.map((tier) => (
              <Card key={tier.id} shadow="sm" className="loyalty-tier-card">
                {editingTier === tier.id ? (
                  <div className="loyalty-tier-edit-form">
                    <div className="loyalty-tier-field">
                      <Localized id="loyalty-tier-name"><span className="loyalty-tier-label">Name</span></Localized>
                      <Localized id="loyalty-tier-name-aria" attrs={{ 'aria-label': true }}>
                      <input className="loyalty-tier-input" value={tierForm.name} onChange={(e) => setTierForm((prev) => ({ ...prev, name: e.target.value }))} />
                      </Localized>
                    </div>
                    <div className="loyalty-tier-field">
                      <Localized id="loyalty-tier-min-points"><span className="loyalty-tier-label">Min Points</span></Localized>
                      <Localized id="loyalty-tier-min-points-aria" attrs={{ 'aria-label': true }}>
                      <input className="loyalty-tier-input" type="number" value={tierForm.min_points} onChange={(e) => setTierForm((prev) => ({ ...prev, min_points: e.target.value }))} />
                      </Localized>
                    </div>
                    <div className="loyalty-tier-field">
                      <Localized id="loyalty-tier-ppu"><span className="loyalty-tier-label">Points/Unit</span></Localized>
                      <Localized id="loyalty-tier-ppu-aria" attrs={{ 'aria-label': true }}>
                      <input className="loyalty-tier-input" type="number" value={tierForm.points_per_unit} onChange={(e) => setTierForm((prev) => ({ ...prev, points_per_unit: e.target.value }))} />
                      </Localized>
                    </div>
                    <div className="loyalty-tier-field">
                      <Localized id="loyalty-tier-multiplier"><span className="loyalty-tier-label">Multiplier</span></Localized>
                      <Localized id="loyalty-tier-multiplier-aria" attrs={{ 'aria-label': true }}>
                      <input className="loyalty-tier-input" type="number" step="0.000001" value={tierForm.earn_multiplier} onChange={(e) => setTierForm((prev) => ({ ...prev, earn_multiplier: e.target.value }))} />
                      </Localized>
                    </div>
                    <div className="loyalty-tier-field">
                      <Localized id="loyalty-tier-colour"><span className="loyalty-tier-label">Colour</span></Localized>
                      <Localized id="loyalty-tier-colour-aria" attrs={{ 'aria-label': true }}>
                      <input className="loyalty-tier-input loyalty-tier-colour-input" type="color" value={tierForm.colour} onChange={(e) => setTierForm((prev) => ({ ...prev, colour: e.target.value }))} />
                      </Localized>
                    </div>
                    {error && <div className="loyalty-mgmt-error" role="alert">{error}</div>}
                    <div className="loyalty-tier-edit-actions">
                      <Button variant="ghost" onClick={() => setEditingTier(null)} disabled={savingTier}>
                        <Localized id="cancel">Cancel</Localized>
                      </Button>
                      <Button variant="primary" loading={savingTier} onClick={handleSaveTier}>
                        <Localized id="save">Save</Localized>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="loyalty-tier-head" style={{ borderLeftColor: tier.colour }}>
                      <h3 className="loyalty-tier-name">{tier.name}</h3>
                      <span className="loyalty-tier-badge" style={{ background: tier.colour, color: contrastFg(tier.colour) }}>{tier.name}</span>
                    </div>
                    <div className="loyalty-tier-details">
                      <div className="loyalty-tier-detail">
                        <Localized id="loyalty-tier-min-points"><span>Min Points</span></Localized>
                        <span>{tier.min_points.toLocaleString(numLocale)}</span>
                      </div>
                      <div className="loyalty-tier-detail">
                        <Localized id="loyalty-tier-ppu"><span>Points/Unit</span></Localized>
                        <span>{tier.points_per_unit}</span>
                      </div>
                      <div className="loyalty-tier-detail">
                        <Localized id="loyalty-tier-multiplier"><span>Multiplier</span></Localized>
                        <span>{millionthsToDecimalString(tier.earn_multiplier_millionths)}x</span>
                      </div>
                    </div>
                    <Localized id="edit">
                      <button type="button" className="loyalty-tier-edit-btn" onClick={() => openEditTier(tier)}>Edit</button>
                    </Localized>
                  </>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="loyalty-accounts-section">
          {accounts.length === 0 ? (
            <Card shadow="sm">
              <EmptyState
                region="table"
                icon={<NoLoyaltyIcon />}
                title={requiredLocalized(l10n, 'loyalty-no-accounts')}
              />
            </Card>
          ) : (
            <div className="loyalty-table-wrap">
              <table className="loyalty-table" aria-label={l10n.getString('loyalty-table-aria')}>
                <thead>
                  <tr>
                    <Localized id="loyalty-customer"><th>Customer</th></Localized>
                    <Localized id="loyalty-tier"><th>Tier</th></Localized>
                    <Localized id="loyalty-points"><th>Points</th></Localized>
                    <Localized id="loyalty-lifetime-points"><th>Lifetime Points</th></Localized>
                    <Localized id="loyalty-next-tier"><th>Next Tier</th></Localized>
                    <Localized id="loyalty-points-to-next"><th>Points to Next</th></Localized>
                    <Localized id="loyalty-table-actions" attrs={{ 'aria-label': true }}>
                      <th> </th>
                    </Localized>
                  </tr>
                </thead>
                <tbody>{accounts.map((a) => {
                    const customerName = customerMap.get(a.account.customer_id) ?? a.account.customer_id;
                    const isExpanded = selectedAccount === a.account.id;
                    const toggleExpand = () => setSelectedAccount(isExpanded ? null : a.account.id);
                    // LOY-10: the accessible name must identify WHICH account
                    // expands, not a generic "Expand" label shared by every row.
                    const expandLabel = l10n.getString(
                      isExpanded ? 'loyalty-collapse-account' : 'loyalty-expand-account',
                      { name: customerName },
                    );
                    return (
                      <Fragment key={a.account.id}>
                        <tr className="loyalty-table-row" tabIndex={0} role="button" aria-expanded={isExpanded} aria-label={expandLabel} onClick={toggleExpand} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } }}>
                          <td><span className="loyalty-customer-name">{customerName}</span></td>
                          <td>
                            {a.tier ? (
                              <span className="loyalty-tier-badge" style={{ background: a.tier.colour, color: contrastFg(a.tier.colour) }}>
                                {a.tier.name}
                              </span>
                            ) : (
                              <span className="loyalty-tier-badge loyalty-tier-badge--none">—</span>
                            )}
                          </td>
                          <td className="loyalty-points-cell">{a.account.points.toLocaleString(numLocale)}</td>
                          <td className="loyalty-points-cell">{a.account.lifetime_points.toLocaleString(numLocale)}</td>
                          <td>{a.next_tier?.name ?? '—'}</td>
                          <td>{a.points_to_next_tier > 0 ? a.points_to_next_tier.toLocaleString(numLocale) : '—'}</td>
                          <td>
                            <button type="button" className="loyalty-expand-btn" aria-label={expandLabel} aria-expanded={isExpanded} onClick={toggleExpand}>
                              {isExpanded ? '\u25B2' : '\u25BC'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="loyalty-detail-row">
                            <td colSpan={7}>
                              <div className="loyalty-detail-content">
                                <Localized id="loyalty-recent-transactions">
                                  <h4 className="loyalty-detail-title">Recent Activity</h4>
                                </Localized>
                                {a.recent_transactions.length === 0 ? (
                                  <p className="loyalty-detail-empty"><Localized id="loyalty-no-transactions">No transactions yet</Localized></p>
                                ) : (
                                  <table className="loyalty-txn-table" aria-label={l10n.getString('loyalty-txn-table-aria')}>
                                    <thead>
                                      <tr>
                                        <Localized id="loyalty-txn-type"><th>Type</th></Localized>
                                        <Localized id="loyalty-txn-points"><th>Points</th></Localized>
                                        <Localized id="loyalty-txn-description"><th>Description</th></Localized>
                                        <Localized id="loyalty-txn-date"><th>Date</th></Localized>
                                      </tr>
                                    </thead>
                                    <tbody>{a.recent_transactions.map((txn) => (
                                        <tr key={txn.id}>
                                          <td>
                                            <span className={`loyalty-txn-type loyalty-txn-type--${txn.txn_type}`}>
                                              <Localized id={`loyalty-${txn.txn_type}`}>
                                                <span>{txn.txn_type.charAt(0).toUpperCase() + txn.txn_type.slice(1)}</span>
                                              </Localized>
                                            </span>
                                          </td>
                                          <td className={`loyalty-points-cell ${txn.points < 0 ? 'loyalty-points-negative' : 'loyalty-points-positive'}`}>
                                            {txn.points > 0 ? `+${txn.points}` : txn.points}
                                          </td>
                                          <td>{txn.description}</td>
                                          <td className="loyalty-txn-date">{formatDate(txn.created_at, numLocale)}</td>
                                        </tr>
                                      ))}
</tbody>
                                    </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
</tbody>
                </table>
              </div>
          )}
        </div>
      )}
    </div>
  );
}
