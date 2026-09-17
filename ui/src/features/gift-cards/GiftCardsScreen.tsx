import { useState, useCallback, useEffect } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listGiftCards,
  freezeGiftCard,
  unfreezeGiftCard,
  topUpGiftCard,
  type GiftCardWithTransactions,
  type GiftCardFilter,
} from '@/api/giftCards';
import { useToast } from '@/components/Toast';
import { requiredLocalized, EmptyState } from '@/components';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { NoGiftCardsIcon } from '@/components/EmptyStateIllustrations';
import { l10nErrorMessage } from '@/utils/app-error';
import { formatMoney } from '@/types/domain';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import IssueGiftCardModal from './IssueGiftCardModal';
import './GiftCardsScreen.css';

const STATUS_CLASS: Record<string, string> = {
  active: 'gift-card-status--active',
  frozen: 'gift-card-status--frozen',
  redeemed: 'gift-card-status--redeemed',
  expired: 'gift-card-status--expired',
};

/** Short readable date in the active locale (guards invalid ISO strings). */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale);
}

/** Gift card management screen — list, search, filter, freeze/unfreeze, top up, and issue gift cards. */
export default function GiftCardsScreen() {
  const { l10n } = useLocalization();
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  // Dates follow the active Fluent locale (not the browser default).
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const [cards, setCards] = useState<GiftCardWithTransactions[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topUpCardId, setTopUpCardId] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpError, setTopUpError] = useState('');
  const { addToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filter: GiftCardFilter = {};
      if (search.trim()) filter.search = search.trim();
      if (statusFilter) filter.status = statusFilter;
      const result = await listGiftCards(sessionToken, filter);
      setCards(result);
    } catch {
      addToast({ message: requiredLocalized(l10n, 'gift-cards-error-load'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, addToast, l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const handleFreezeToggle = useCallback(async (cardNumber: string, currentStatus: string) => {
    try {
      if (currentStatus === 'frozen') {
        await unfreezeGiftCard(sessionToken, cardNumber);
      } else {
        await freezeGiftCard(sessionToken, cardNumber);
      }
      await load();
    } catch (err) {
      addToast({ message: l10nErrorMessage(err, l10n, 'gift-cards-error-freeze'), type: 'error' });
    }
  }, [load, addToast, l10n, sessionToken]);

  const handleTopUp = useCallback(async (cardNumber: string) => {
    // Reject non-integers (e.g. "500.5") rather than silently truncating.
    const raw = topUpAmount.trim();
    const amount = Number(raw);
    if (raw === '' || !Number.isInteger(amount) || amount <= 0) {
      setTopUpError(l10n.getString('gift-cards-topup-invalid'));
      return;
    }
    setTopUpError('');
    try {
      await topUpGiftCard(sessionToken, cardNumber, amount);
      setTopUpCardId(null);
      setTopUpAmount('');
      await load();
    } catch (err) {
      setTopUpError(l10nErrorMessage(err, l10n, 'gift-cards-error-topup'));
    }
  }, [topUpAmount, load, l10n, sessionToken]);

  return (
    <div className="gift-cards-page">
      <div className="gift-cards-header">
        <Localized id="gift-cards-title">
          <h1 className="gift-cards-title">Gift Cards</h1>
        </Localized>
        <Button variant="primary" onClick={() => setShowIssueModal(true)}>
          <Localized id="gift-cards-issue-btn">+ Issue New Card</Localized>
        </Button>
      </div>

      <div className="gift-cards-toolbar">          <input
            type="text"
            className="gift-cards-search"
            id="gift-cards-search"
            name="gift-cards-search"
            placeholder={l10n.getString('gift-cards-search-placeholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={l10n.getString('gift-cards-search-aria')}
          />
        <select
          className="gift-cards-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label={l10n.getString('gift-cards-status-aria')}
        >
          <Localized id="gift-cards-status-all"><option value="">All Statuses</option></Localized>
          <Localized id="gift-cards-status-active"><option value="active">Active</option></Localized>
          <Localized id="gift-cards-status-frozen"><option value="frozen">Frozen</option></Localized>
          <Localized id="gift-cards-status-redeemed"><option value="redeemed">Redeemed</option></Localized>
          <Localized id="gift-cards-status-expired"><option value="expired">Expired</option></Localized>
        </select>
      </div>

      {loading ? (
        <div className="gift-cards-loading-skeleton" aria-hidden="true">
          <div className="gift-cards-header">
            <Skeleton variant="block" width="7rem" height="1.75rem" />
            <Skeleton variant="block" width="8rem" height="2.25rem" />
          </div>
          <div className="gift-cards-toolbar">
            <Skeleton variant="block" width="100%" height="2.25rem" />
            <Skeleton variant="block" width="8.75rem" height="2.25rem" />
          </div>
          <div className="gift-cards-list">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} shadow="sm" className="gift-card-card">
                <div className="gift-card-summary">
                  <div className="gift-card-summary-left">
                    <Skeleton variant="text" width={`${7 + (i % 3) * 2}rem`} />
                    <Skeleton variant="text" width="4rem" />
                  </div>
                  <div className="gift-card-summary-right">
                    <Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} />
                    <Skeleton variant="text" width="5rem" />
                    <Skeleton variant="text" width="0.625rem" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : cards.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NoGiftCardsIcon />}
            title={requiredLocalized(l10n, 'gift-cards-no-cards')}
          />
        </Card>
      ) : (
        <div className="gift-cards-list">
          {cards.map((gc) => (
            <Card key={gc.card.id} shadow="sm" className="gift-card-card">
              <button
                type="button"
                className="gift-card-summary"
                aria-expanded={expandedId === gc.card.id}
                onClick={() => setExpandedId(expandedId === gc.card.id ? null : gc.card.id)}
              >
                <div className="gift-card-summary-left">
                  <span className="gift-card-number">{gc.card.card_number}</span>
                  {gc.card.issued_to && (
                    <span className="gift-card-issued-to">{gc.card.issued_to}</span>
                  )}
                </div>
                <div className="gift-card-summary-right">
                  <span className={`gift-card-status ${STATUS_CLASS[gc.card.status] || ''}`}>
                    {l10n.getString(`gift-cards-status-${gc.card.status}`, null, gc.card.status)}
                  </span>
                  <span className="gift-card-balance">
                    {formatMoney({ minor_units: gc.card.current_balance_minor, currency: gc.card.currency })}
                  </span>
                  <span className={`gift-card-expand ${expandedId === gc.card.id ? 'expanded' : ''}`}>
                    &#9660;
                  </span>
                </div>
              </button>

              {expandedId === gc.card.id && (
                <div className="gift-card-detail">
                  <div className="gift-card-info-grid">
                    <div className="gift-card-info-item">
                      <Localized id="gift-cards-info-initial-balance"><span className="gift-card-info-label">Initial Balance</span></Localized>
                      <span>{formatMoney({ minor_units: gc.card.initial_balance_minor, currency: gc.card.currency })}</span>
                    </div>
                    <div className="gift-card-info-item">
                      <Localized id="gift-cards-info-issued"><span className="gift-card-info-label">Issued</span></Localized>
                      <span>{formatDate(gc.card.issue_date, numLocale)}</span>
                    </div>
                    {gc.card.expiry_date && (
                      <div className="gift-card-info-item">
                        <Localized id="gift-cards-info-expires"><span className="gift-card-info-label">Expires</span></Localized>
                        <span>{formatDate(gc.card.expiry_date, numLocale)}</span>
                      </div>
                    )}
                  </div>

                  <div className="gift-card-actions">
                    {gc.card.status === 'active' || gc.card.status === 'frozen' ? (
                      <Button
                        variant="ghost"
                        onClick={() => handleFreezeToggle(gc.card.card_number, gc.card.status)}
                      >
                        {gc.card.status === 'frozen' ? (
                          <Localized id="gift-cards-unfreeze"><span>Unfreeze</span></Localized>
                        ) : (
                          <Localized id="gift-cards-freeze"><span>Freeze</span></Localized>
                        )}
                      </Button>
                    ) : null}
                    {gc.card.status === 'active' && (
                      <Button variant="primary" onClick={() => setTopUpCardId(gc.card.id)}>
                        <Localized id="gift-cards-top-up"><span>Top Up</span></Localized>
                      </Button>
                    )}
                  </div>

                  {topUpCardId === gc.card.id && (
                    <div className="gift-card-topup-form">
                      <input
                        type="number"
                        className="gift-card-topup-input"
                        id="gift-card-topup-amount"
                        name="gift-card-topup-amount"
                        placeholder={requiredLocalized(l10n, 'gift-cards-topup-placeholder')}
                        value={topUpAmount}
                        onChange={(e) => { setTopUpAmount(e.target.value); setTopUpError(''); }}
                        aria-label={requiredLocalized(l10n, 'gift-cards-topup-aria')}
                      />
                      <Localized id="gift-cards-confirm-topup">
                        <Button variant="primary" onClick={() => handleTopUp(gc.card.card_number)}>
                          <span>Confirm Top-Up</span>
                        </Button>
                      </Localized>
                      <Localized id="gift-cards-cancel-topup">
                        <Button variant="ghost" onClick={() => { setTopUpCardId(null); setTopUpAmount(''); }}>
                          <span>Cancel</span>
                        </Button>
                      </Localized>
                      {topUpError && <div className="gift-card-topup-error">{topUpError}</div>}
                    </div>
                  )}

                  {gc.transactions.length > 0 && (
                    <div className="gift-card-transactions">
                      <Localized id="gift-cards-recent-transactions">
                        <h4 className="gift-card-txn-title">Recent Transactions</h4>
                      </Localized>
                      <table className="gift-card-txn-table">
                        <thead>
                          <tr>
                            <Localized id="gift-cards-txn-type"><th>Type</th></Localized>
                            <Localized id="gift-cards-txn-amount"><th>Amount</th></Localized>
                            <Localized id="gift-cards-txn-balance"><th>Balance</th></Localized>
                            <Localized id="gift-cards-txn-notes"><th>Notes</th></Localized>
                            <Localized id="gift-cards-txn-date"><th>Date</th></Localized>
                          </tr>
                        </thead>
                        <tbody>{gc.transactions.map((txn) => (
                            <tr key={txn.id}>
                              <td>
                                <span className={`gift-card-txn-type gift-card-txn-type--${txn.txn_type}`}>
                                  {l10n.getString(`gift-cards-txn-${txn.txn_type}`, null, txn.txn_type)}
                                </span>
                              </td>
                              <td className={`gift-card-txn-amount ${txn.amount_minor < 0 ? 'negative' : 'positive'}`}>
                                {txn.amount_minor > 0 ? '+' : ''}
                                {formatMoney({ minor_units: Math.abs(txn.amount_minor), currency: gc.card.currency })}
                              </td>
                              <td>{formatMoney({ minor_units: txn.balance_after_minor, currency: gc.card.currency })}</td>
                              <td className="gift-card-txn-notes">{txn.notes}</td>
                              <td className="gift-card-txn-date">{formatDate(txn.created_at, numLocale)}</td>
                            </tr>
                          ))}
</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {showIssueModal && (
        <IssueGiftCardModal
          sessionToken={sessionToken}
          onClose={() => setShowIssueModal(false)}
          onIssued={() => {
            setShowIssueModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
