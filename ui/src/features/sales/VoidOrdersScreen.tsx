import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import { Localized } from '@/frontend/shared/Localized';
import {
  listSales,
  getSale,
  voidSaleScoped,
  type SaleListItem,
  type SaleDetail,
} from '@/api/sales';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { formatMoney } from '@/types/domain';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Skeleton } from '@/components/Skeleton';
import { l10nErrorMessage } from '@/utils/app-error';
import './VoidOrdersScreen.css';

// ── Reason options ──────────────────────────────────────────────────

const VOID_REASONS = [
  { value: 'cancelled-by-customer', id: 'void-orders-reason-cancelled' },
  { value: 'wrong-items', id: 'void-orders-reason-wrong-items' },
  { value: 'duplicate-order', id: 'void-orders-reason-duplicate' },
  { value: 'price-dispute', id: 'void-orders-reason-price-dispute' },
  { value: 'payment-issue', id: 'void-orders-reason-payment-issue' },
  { value: 'customer-change-of-mind', id: 'void-orders-reason-changed-mind' },
  { value: 'manager-authorization', id: 'void-orders-reason-manager-override' },
  { value: 'other', id: 'void-orders-reason-other' },
] as const;

// ── Helpers ─────────────────────────────────────────────────────────

function statusBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'Completed': return 'success';
    case 'Active': return 'info';
    case 'Pending': return 'warning';
    case 'Voided': return 'danger';
    default: return 'info';
  }
}

function statusLabelFluentId(status: string): string {
  switch (status) {
    case 'Active': return 'void-orders-status-active';
    case 'Completed': return 'void-orders-status-completed';
    case 'Voided': return 'void-orders-status-voided';
    case 'Pending': return 'void-orders-status-pending';
    default: return 'void-orders-status-active';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Component ───────────────────────────────────────────────────────

type ViewMode = 'list' | 'detail';
type FilterStatus = 'all' | 'Active' | 'Completed' | 'Voided' | 'Pending';

interface VoidOrdersScreenProps {
  /** ID of the sale to open directly (for navigating from POS after completion). */
  initialSaleId?: string;
}

/** Void orders screen — lists active, completed, and pending sales with reason selection and manager-authorised voiding. */
export default function VoidOrdersScreen({ initialSaleId }: VoidOrdersScreenProps) {
  const { l10n } = useLocalization();
  const { sessionToken } = useWorkspace();

  // Data
  const [sales, setSales] = useState<SaleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');

  // Detail view
  const [viewMode, setViewMode] = useState<ViewMode>(initialSaleId ? 'detail' : 'list');
  const [activeSaleId, setActiveSaleId] = useState<string | null>(initialSaleId ?? null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Void flow
  const [voidReason, setVoidReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccess, setVoidSuccess] = useState<string | null>(null);

  // ── Load sales ──────────────────────────────────────────────────

  const loadSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { sales: items } = await listSales();
      setSales(items);
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'void-orders-error-load'));
    } finally {
      setLoading(false);
    }
  }, [l10n]);

  useEffect(() => { loadSales(); }, [loadSales]);

  // Load detail when a sale is selected.
  useEffect(() => {
    if (!activeSaleId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const sale = await getSale(activeSaleId);
        if (!cancelled) setDetail(sale);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSaleId]);

  // ── Open initial sale if provided ────────────────────────────────

  useEffect(() => {
    if (initialSaleId && sales.length > 0) {
      const exists = sales.some((s) => s.id === initialSaleId);
      if (exists) {
        setActiveSaleId(initialSaleId);
        setViewMode('detail');
      }
    }
  }, [initialSaleId, sales]);

  // ── Filtered sales ──────────────────────────────────────────────

  const filteredSales = useMemo(() => {
    let items = sales;

    if (statusFilter !== 'all') {
      items = items.filter((s) => s.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          (s.paymentMethod ?? '').toLowerCase().includes(q),
      );
    }

    return items;
  }, [sales, statusFilter, searchQuery]);

  // ── Void handler ────────────────────────────────────────────────

  const handleVoid = useCallback(async () => {
    if (!activeSaleId || !detail) return;

    const reason = voidReason === 'other' ? customReason.trim() : voidReason;
    if (!reason) {
      setVoidError(l10n.getString('void-orders-error-reason'));
      return;
    }

    setVoiding(true);
    setVoidError(null);
    setVoidSuccess(null);

    try {
      await voidSaleScoped(sessionToken!, activeSaleId, reason);
      setVoidSuccess(l10n.getString('void-orders-success-voided'));
      setVoidError(null);
      setVoidReason('');
      setCustomReason('');
      // Refresh just the detail without a full list reload to avoid flicker.
      const updated = await getSale(activeSaleId);
      if (updated) setDetail(updated);
    } catch (err) {
      setVoidError(l10nErrorMessage(err, l10n, 'void-orders-error-void'));
    } finally {
      setVoiding(false);
    }
    // sessionToken is read at :189 and was missing; session?.user_id was listed but is never
    // read anywhere in this body, so it is dropped -- eslint only reported the missing token
    // until the token was added, because the rule surfaces one problem per hook. Same shape as
    // SalesHistoryScreen.handleConfirmVoid, and the same audit-trail consequence: a void
    // presented under a stale session is recorded against the wrong cashier.
    //
    // Separate gap, deliberately not touched here: :195 calls the UNSCOPED getSale() from a
    // screen that otherwise routes through the scoped API, so it reads the ambient store rather
    // than the session's. That is an ADR #7 omission, not a stale closure.
  }, [activeSaleId, detail, voidReason, customReason, l10n, sessionToken]);


  const openDetail = useCallback((id: string) => {
    setActiveSaleId(id);
    setViewMode('detail');
    setVoidError(null);
    setVoidSuccess(null);
    setVoidReason('');
    setCustomReason('');
  }, []);

  const backToList = useCallback(() => {
    setViewMode('list');
    setActiveSaleId(null);
    setDetail(null);
    setVoidError(null);
    setVoidSuccess(null);
    setVoidReason('');
    setCustomReason('');
  }, []);

  // ── Render: List view ──────────────────────────────────────────

  if (viewMode === 'list') {
    return (
      <div className="void-orders">
        <div className="void-orders-header">
          <Localized id="void-orders-title">
            <h1 className="void-orders-title">Orders</h1>
          </Localized>
        </div>

        {/* Filters */}
        <div className="void-orders-filters">
          <div className="void-orders-search-wrap">
            <svg className="void-orders-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <Localized id="void-orders-search-aria" attrs={{ 'aria-label': true }}>
            <Localized id="void-orders-search-placeholder" attrs={{ placeholder: true }}>
              <input
                type="search"
                className="void-orders-search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                placeholder="Search by order ID or payment method…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </Localized>
            </Localized>
          </div>

          <Localized id="void-orders-filter-status-aria" attrs={{ 'aria-label': true }}>
          <div className="void-orders-status-filters" role="radiogroup">
            {(['all', 'Active', 'Completed', 'Voided', 'Pending'] as FilterStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                className={`void-orders-status-chip ${statusFilter === status ? 'void-orders-status-chip--active' : ''}`}
                onClick={() => setStatusFilter(status)}
                role="radio"
                aria-checked={statusFilter === status}
              >
                {status === 'all' ? (
                  <Localized id="void-orders-status-all">
                    <span>All</span>
                  </Localized>
                ) : (
                  <Localized id={statusLabelFluentId(status)}>
                    <span>{status}</span>
                  </Localized>
                )}
              </button>
            ))}
          </div>
          </Localized>
        </div>

        {/* Content */}
        {loading ? (
          <div className="void-orders-loading-skeleton" aria-hidden="true">
            {/* Header */}
            <div className="void-orders-header">
              <Skeleton width="8rem" height="1.75rem" />
            </div>
            {/* Filter bar: search + status chips */}
            <div className="void-orders-filters">
              <div className="void-orders-search-wrap">
                <Skeleton width="100%" height="2.25rem" style={{ borderRadius: 'var(--radius-lg)' }} />
              </div>
              <div className="void-orders-status-filters">
                <Skeleton width="3rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
                <Skeleton width="4rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
                <Skeleton width="4.5rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
                <Skeleton width="3.5rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
                <Skeleton width="4rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
              </div>
            </div>
            {/* 7-column table with 5 skeleton rows */}
            <div className="void-orders-table-wrap">
              <table className="void-orders-table">
                <thead>
                  <tr>
                    <Localized id="void-orders-col-order-id"><th>Order ID</th></Localized>
                    <Localized id="void-orders-col-date"><th>Date</th></Localized>
                    <Localized id="void-orders-col-status"><th>Status</th></Localized>
                    <Localized id="void-orders-col-total"><th>Total</th></Localized>
                    <Localized id="void-orders-col-items"><th>Items</th></Localized>
                    <Localized id="void-orders-col-payment"><th>Payment</th></Localized>
                    <Localized id="void-orders-col-actions-aria" attrs={{ 'aria-label': true }}><th aria-label={l10n.getString('actions-aria')}> </th></Localized>
                  </tr>
                </thead>
                <tbody>{Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton width="5rem" height="1rem" /></td>
                      <td><Skeleton width="8rem" height="1rem" /></td>
                      <td><Skeleton width="4.5rem" height="1.25rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                      <td><Skeleton width="5rem" height="1rem" /></td>
                      <td><Skeleton width="2rem" height="1rem" /></td>
                      <td><Skeleton width="5rem" height="1rem" /></td>
                      <td><Skeleton width="3rem" height="1.25rem" style={{ borderRadius: 'var(--radius-md)' }} /></td>
                    </tr>
                  ))}
</tbody>
              </table>
            </div>
          </div>
        ) : error ? (
          <Card shadow="sm">
            <div className="void-orders-error">
              <p>{error}</p>
              <Localized id="void-orders-retry">
                <Button variant="secondary" onClick={loadSales}>Retry</Button>
              </Localized>
            </div>
          </Card>
        ) : filteredSales.length === 0 ? (
          <Card shadow="sm">
            <div className="void-orders-empty">
              {searchQuery || statusFilter !== 'all' ? (
                <Localized id="void-orders-empty-filtered">
                  <span>No orders match the current filters.</span>
                </Localized>
              ) : (
                <Localized id="void-orders-empty-none">
                  <span>No orders recorded yet.</span>
                </Localized>
              )}
            </div>
          </Card>
        ) : (
          <div className="void-orders-table-wrap">
            <Localized id="void-orders-table-aria" attrs={{ 'aria-label': true }}>
              <table className="void-orders-table" aria-label={l10n.getString('orders-aria')}>
                <thead>
                  <tr>
                    <Localized id="void-orders-col-order-id">
                      <th>Order ID</th>
                    </Localized>
                    <Localized id="void-orders-col-date">
                      <th>Date</th>
                    </Localized>
                    <Localized id="void-orders-col-status">
                      <th>Status</th>
                    </Localized>
                    <Localized id="void-orders-col-total">
                      <th>Total</th>
                    </Localized>
                    <Localized id="void-orders-col-items">
                      <th>Items</th>
                    </Localized>
                    <Localized id="void-orders-col-payment">
                      <th>Payment</th>
                    </Localized>
                    <Localized id="void-orders-col-actions-aria" attrs={{ 'aria-label': true }}>
                      <th aria-label={l10n.getString('actions-aria')}> </th>
                    </Localized>
                  </tr>
                </thead>
                <tbody>{filteredSales.map((sale) => (
                    <tr key={sale.id} className={sale.status === 'Active' ? 'void-orders-row--active' : ''}>
                      <td className="void-orders-cell-id">{sale.id.slice(0, 8)}&hellip;</td>
                      <td>{formatDate(sale.createdAt)}</td>
                      { }
                      <td>
                        <Badge variant={statusBadgeVariant(sale.status)}>
                          <Localized id={statusLabelFluentId(sale.status)}>
                            <span>{sale.status}</span>
                          </Localized>
                        </Badge>
                      </td>
                      <td className="void-orders-cell-total">{formatMoney(sale.total)}</td>
                      <td>{sale.lineCount}</td>
                      <td>{sale.paymentMethod ?? '\u2014'}</td>
                      <td className="void-orders-cell-actions">
                        <Localized id="void-orders-view-aria" attrs={{ 'aria-label': true }} vars={{ id: sale.id }}>
                          <button
                            type="button"
                            className="void-orders-action-btn"
                            onClick={() => openDetail(sale.id)}
                            aria-label={`View order ${sale.id}`}
                          >
                            <Localized id="void-orders-view">
                              <span>View</span>
                            </Localized>
                          </button>
                        </Localized>
                        {sale.status === 'Active' && (
                          <Localized id="void-orders-void-aria" attrs={{ 'aria-label': true }} vars={{ id: sale.id }}>
                            <button
                              type="button"
                              className="void-orders-action-btn void-orders-action-btn--void"
                              onClick={() => openDetail(sale.id)}
                              aria-label={`Void order ${sale.id}`}
                            >
                              <Localized id="void-orders-void">
                                <span>Void</span>
                              </Localized>
                            </button>
                          </Localized>
                        )}
                      </td>
                    </tr>
                  ))}
</tbody>
              </table>
            </Localized>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Detail view ────────────────────────────────────────

  const canVoid = detail?.status === 'Active';

  return (
    <div className="void-orders">
      <div className="void-orders-header">
        <Localized id="void-orders-back-aria" attrs={{ 'aria-label': true }}>
          <button
            type="button"
            className="void-orders-back-btn"
            onClick={backToList}
            aria-label={l10n.getString('back-to-orders-aria')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <Localized id="void-orders-back">
              <span>Back to Orders</span>
            </Localized>
          </button>
        </Localized>
      </div>

      {detailLoading ? (
        <div className="void-orders-detail-skeleton" aria-hidden="true">
          {/* Back button skeleton */}
          <div className="void-orders-header">
            <Skeleton width="7rem" height="1.5rem" />
          </div>
          {/* Summary card */}
          <Card shadow="sm">
            <div className="void-orders-detail-summary">
              <div className="void-orders-detail-header">
                <Skeleton width="8rem" height="1.5rem" />
                <Skeleton width="4rem" height="1.25rem" style={{ borderRadius: 'var(--radius-full)' }} />
              </div>
              <div className="void-orders-detail-meta">
                <div className="void-orders-meta-item">
                  <span className="void-orders-meta-label"><Skeleton width="3rem" height="0.75rem" /></span>
                  <Skeleton width="7rem" height="1rem" />
                </div>
                <div className="void-orders-meta-item">
                  <span className="void-orders-meta-label"><Skeleton width="4rem" height="0.75rem" /></span>
                  <Skeleton width="5rem" height="1rem" />
                </div>
                <div className="void-orders-meta-item">
                  <span className="void-orders-meta-label"><Skeleton width="3rem" height="0.75rem" /></span>
                  <Skeleton width="5rem" height="1rem" />
                </div>
                <div className="void-orders-meta-item">
                  <span className="void-orders-meta-label"><Skeleton width="3rem" height="0.75rem" /></span>
                  <Skeleton width="2rem" height="1rem" />
                </div>
              </div>
            </div>
          </Card>
          {/* Line items card */}
          <Card shadow="sm" className="void-orders-section">
            <Skeleton width="6rem" height="1.25rem" />
            <table className="void-orders-lines-table">
              <thead>
                <tr>
                  <Localized id="void-orders-line-sku"><th>SKU</th></Localized>
                  <Localized id="void-orders-line-name"><th>Name</th></Localized>
                  <Localized id="void-orders-line-qty"><th>Qty</th></Localized>
                  <Localized id="void-orders-line-unit-price"><th>Unit Price</th></Localized>
                  <Localized id="void-orders-line-total"><th>Total</th></Localized>
                </tr>
              </thead>
              <tbody>{Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td><Skeleton width="4rem" height="1rem" /></td>
                    <td><Skeleton width="8rem" height="1rem" /></td>
                    <td><Skeleton width="2rem" height="1rem" /></td>
                    <td><Skeleton width="4rem" height="1rem" /></td>
                    <td><Skeleton width="4rem" height="1rem" /></td>
                  </tr>
                ))}
</tbody>
            </table>
          </Card>
        </div>
      ) : !detail ? (
        <Card shadow="sm">
          <div className="void-orders-error">
            <Localized id="void-orders-not-found">
              <p>Order not found.</p>
            </Localized>
            <Localized id="void-orders-go-back">
              <Button variant="secondary" onClick={backToList}>Go back</Button>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="void-orders-detail">
          {/* Order summary card */}
          <Card shadow="sm">
            <div className="void-orders-detail-summary">
              <div className="void-orders-detail-header">
                <Localized id="void-orders-detail-heading" vars={{ id: detail.id.slice(0, 8) }}>
                  <h2 className="void-orders-detail-id">Order {detail.id.slice(0, 8)}</h2>
                </Localized>
                <Badge variant={statusBadgeVariant(detail.status)}>
                  <Localized id={statusLabelFluentId(detail.status)}>
                    <span>{detail.status}</span>
                  </Localized>
                </Badge>
              </div>

              <div className="void-orders-detail-meta">
                <div className="void-orders-meta-item">
                  <Localized id="void-orders-meta-date">
                    <span className="void-orders-meta-label">Date</span>
                  </Localized>
                  <span className="void-orders-meta-value">{formatDate(detail.createdAt)}</span>
                </div>
                <div className="void-orders-meta-item">
                  <Localized id="void-orders-meta-payment">
                    <span className="void-orders-meta-label">Payment</span>
                  </Localized>
                  <span className="void-orders-meta-value">{detail.paymentMethod ?? '\u2014'}</span>
                </div>
                <div className="void-orders-meta-item">
                  <Localized id="void-orders-meta-total">
                    <span className="void-orders-meta-label">Total</span>
                  </Localized>
                  <span className="void-orders-meta-value void-orders-meta-value--total">{formatMoney(detail.total)}</span>
                </div>
                <div className="void-orders-meta-item">
                  <Localized id="void-orders-meta-items">
                    <span className="void-orders-meta-label">Items</span>
                  </Localized>
                  <span className="void-orders-meta-value">{detail.lineCount}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Line items */}
          <Card shadow="sm" className="void-orders-section">
            <Localized id="void-orders-line-items-title">
              <h3 className="void-orders-section-title">Line Items</h3>
            </Localized>
            <Localized id="void-orders-line-items-aria" attrs={{ 'aria-label': true }}>
              <table className="void-orders-lines-table" aria-label={l10n.getString('order-line-items-aria')}>
                <thead>
                  <tr>
                    <Localized id="void-orders-line-sku">
                      <th>SKU</th>
                    </Localized>
                    <Localized id="void-orders-line-name">
                      <th>Name</th>
                    </Localized>
                    <Localized id="void-orders-line-qty">
                      <th>Qty</th>
                    </Localized>
                    <Localized id="void-orders-line-unit-price">
                      <th>Unit Price</th>
                    </Localized>
                    <Localized id="void-orders-line-total">
                      <th>Total</th>
                    </Localized>
                  </tr>
                </thead>
                <tbody>{detail.lines.map((line, i) => (
                    <tr key={i}>
                      <td className="void-orders-cell-mono">{line.sku}</td>
                      <td>{line.name}</td>
                      <td>{line.qty}</td>
                      <td>{formatMoney(line.unit_price)}</td>
                      <td className="void-orders-cell-total">
                        {formatMoney({
                          minor_units: line.total_minor,
                          currency: line.unit_price.currency,
                        })}
                      </td>
                    </tr>
                  ))}
</tbody>
              </table>
            </Localized>
          </Card>

          {/* Void action (only for Active sales) */}
          {canVoid && (
            <Card shadow="sm" className="void-orders-section void-orders-void-section">
              <Localized id="void-orders-void-section-title">
                <h3 className="void-orders-section-title void-orders-section-title--danger">
                  Void Order
                </h3>
              </Localized>
              <Localized id="void-orders-void-description">
                <p className="void-orders-void-desc">
                  This will cancel the order, restore all items to inventory,
                  and create an immutable audit log entry. This action cannot
                  be undone.
                </p>
              </Localized>

              {/* Reason picker */}
              <div className="void-orders-reason-group">
                <Localized id="void-orders-reason-label">
                  <label className="void-orders-reason-label" htmlFor="void-reason-select">
                    Reason for void
                  </label>
                </Localized>
                <select
                  id="void-reason-select"
                  className="void-orders-reason-select"
                  value={voidReason}
                  onChange={(e) => {
                    setVoidReason(e.target.value);
                    setVoidError(null);
                  }}
                  aria-describedby="void-reason-desc"
                >
                  <Localized id="void-orders-reason-select">
                    <option value="">Select a reason…</option>
                  </Localized>
                  {VOID_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {l10n.getString(r.id)}
                    </option>
                  ))}
                </select>

                {voidReason === 'other' && (
                   
                  <Localized id="void-orders-reason-aria" attrs={{ 'aria-label': true }}>
                  <Localized id="void-orders-reason-placeholder" attrs={{ placeholder: true }}>
                    <input
                      type="text"
                      className="void-orders-reason-input"
                      placeholder="Enter the reason for voiding this order…"
                      value={customReason}
                      onChange={(e) => {
                        setCustomReason(e.target.value);
                        setVoidError(null);
                      }}
                    />
                  </Localized>
                  </Localized>
                )}
              </div>

              {voidError && (
                <div className="void-orders-void-error" role="alert">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {voidError}
                </div>
              )}

              {voidSuccess && (
                <div className="void-orders-void-success" role="status">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  {voidSuccess}
                </div>
              )}

              <div className="void-orders-void-actions">
                <Localized id="void-orders-cancel">
                  <Button variant="ghost" onClick={backToList}>
                    <span>Cancel</span>
                  </Button>
                </Localized>
                <Button
                  variant="danger"
                  onClick={handleVoid}
                  loading={voiding}
                  disabled={!voidReason || (voidReason === 'other' && !customReason.trim())}
                >
                  {voiding ? (
                    <Localized id="void-orders-confirm-voiding">
                      <span>Voiding…</span>
                    </Localized>
                  ) : (
                    <Localized id="void-orders-confirm">
                      <span>Confirm Void</span>
                    </Localized>
                  )}
                </Button>
              </div>
            </Card>
          )}

          {/* Already voided notice */}
          {detail.status === 'Voided' && (
            <Card shadow="sm" className="void-orders-section">
              <div className="void-orders-voided-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <Localized id="void-orders-voided-notice">
                  <span>This order has been voided.</span>
                </Localized>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
