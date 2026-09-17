import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { requiredLocalized, EmptyState } from '@/components';
import { NoPurchaseOrdersIcon } from '@/components/EmptyStateIllustrations';
import {
  listPurchaseOrdersScoped,
  updatePoStatusScoped,
  receivePurchaseOrderScoped,
  type PurchaseOrderDto,
} from '@/api/purchasing';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { useCurrency } from '@/contexts/CurrencyContext';
import { minorUnitExponent } from '@/types/domain';
import PurchaseOrderForm from './PurchaseOrderForm';
import './PurchaseOrdersScreen.css';

const STATUSES = ['draft', 'pending', 'approved', 'received', 'cancelled'];

function formatMinor(minor: number, currency: string): string {
  // Exponent-driven via minorUnitExponent (IDR/JPY = 0, KWD = 3, USD/EUR = 2).
  const exp = minorUnitExponent(currency);
  return (minor / 10 ** exp).toFixed(exp);
}

/** Purchase orders list screen — view, filter, approve, receive, and cancel purchase orders with status management. */
export default function PurchaseOrdersScreen() {
  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  const { currency } = useCurrency();
  const { addToast } = useToast();
  // F-005: the desktop shell only registers the *_scoped purchasing
  // commands, so every call below carries the session token.
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [orders, setOrders] = useState<PurchaseOrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPurchaseOrdersScoped(sessionToken);
      setOrders(data);
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'po-error-load'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    setActionLoading(id);
    try {
      await updatePoStatusScoped(sessionToken, { id, status });
      await load();
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'po-error-update'), type: 'error' });
    } finally {
      setActionLoading(null);
    }
  }, [load, addToast, sessionToken]);

  const handleReceive = useCallback(async (id: string) => {
    setActionLoading(id);
    try {
      await receivePurchaseOrderScoped(sessionToken, id);
      await load();
    } catch {
      addToast({ message: requiredLocalized(l10nRef.current, 'po-error-receive'), type: 'error' });
    } finally {
      setActionLoading(null);
    }
  }, [load, addToast, sessionToken]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
  }, []);

  const onSaved = useCallback(() => {
    closeForm();
    load();
  }, [closeForm, load]);

  return (
    <div className="po-screen">
      <div className="po-header">
        <Localized id="po-title">
          <h1 className="po-title">Purchase Orders</h1>
        </Localized>
        <Localized id="po-add">
          <Button onClick={openCreate}>New Purchase Order</Button>
        </Localized>
      </div>

      <div className="po-filters">
        {['all', ...STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            className={`po-filter-btn ${statusFilter === s ? 'po-filter-btn--active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            <Localized id={`po-status-${s}`}>
              <span>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</span>
            </Localized>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="po-loading-skeleton" aria-hidden="true">
          <div className="po-header">
            <Skeleton variant="block" width="12rem" height="1.75rem" />
            <Skeleton variant="block" width="11rem" height="2.25rem" />
          </div>
          <div className="po-filters">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} variant="block" width="4.5rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
            ))}
          </div>
          <div className="po-table-wrap">
            <table className="po-table" aria-hidden="true">
              <thead>
                <tr>
                  {['PO #', 'Supplier', 'Status', 'Order Date', 'Expected', 'Total', 'Items', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 7 ? '4rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="5rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="7rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="4.5rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="6rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="6rem" height="0.75rem" /></td>
                    <td><Skeleton variant="text" width="4rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="2rem" height="0.875rem" /></td>
                    <td className="po-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <Card shadow="sm">
          <EmptyState
            region="table"
            icon={<NoPurchaseOrdersIcon />}
            title={
              statusFilter === 'all'
                ? requiredLocalized(l10n, 'po-empty')
                : requiredLocalized(l10n, 'po-empty-filtered', { status: statusFilter })
            }
            action={{
              label: requiredLocalized(l10n, 'po-add'),
              onClick: openCreate,
            }}
          />
        </Card>
      ) : (
        <div className="po-table-wrap">
          <table className="po-table" aria-label={requiredLocalized(l10n, 'po-title')}>
            <thead>
              <tr>
                <Localized id="po-col-number"><th>PO #</th></Localized>
                <Localized id="po-col-supplier"><th>Supplier</th></Localized>
                <Localized id="po-col-status"><th>Status</th></Localized>
                <Localized id="po-col-order-date"><th>Order Date</th></Localized>
                <Localized id="po-col-expected"><th>Expected</th></Localized>
                <Localized id="po-col-total"><th>Total</th></Localized>
                <Localized id="po-col-items"><th>Items</th></Localized>
                <Localized id="po-col-actions" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{filtered.map((po) => (
                <tr key={po.id}>
                  <td className="po-cell-number">{po.po_number}</td>
                  <td>{po.supplier_name || po.supplier_id}</td>
                  <td>
                    <span className={`po-status po-status--${po.status}`}>
                      <Localized id={`po-status-${po.status}`}>{po.status}</Localized>
                    </span>
                  </td>
                  <td className="po-cell-date">{po.order_date.slice(0, 10)}</td>
                  <td className="po-cell-date">{po.expected_date ? po.expected_date.slice(0, 10) : '\u2014'}</td>
                  <td className="po-cell-total">{formatMinor(po.total_minor, currency)}</td>
                  <td>{po.lines.length}</td>
                  <td className="po-cell-actions">
                    {po.status === 'draft' && (
                      <Localized id="po-action-submit">
                        <button
                          type="button"
                          className="po-action-btn"
                          disabled={actionLoading === po.id}
                          onClick={() => handleStatusChange(po.id, 'pending')}
                        >
                          Submit
                        </button>
                      </Localized>
                    )}
                    {po.status === 'pending' && (
                      <Localized id="po-action-approve">
                        <button
                          type="button"
                          className="po-action-btn"
                          disabled={actionLoading === po.id}
                          onClick={() => handleStatusChange(po.id, 'approved')}
                        >
                          Approve
                        </button>
                      </Localized>
                    )}
                    {po.status === 'approved' && (
                      <Localized id="po-action-receive">
                        <button
                          type="button"
                          className="po-action-btn po-action-btn--primary"
                          disabled={actionLoading === po.id}
                          onClick={() => handleReceive(po.id)}
                        >
                          Receive
                        </button>
                      </Localized>
                    )}
                    {(po.status === 'draft' || po.status === 'pending') && (
                      <Localized id="po-action-cancel">
                        <button
                          type="button"
                          className="po-action-btn po-action-btn--danger"
                          disabled={actionLoading === po.id}
                          onClick={() => handleStatusChange(po.id, 'cancelled')}
                        >
                          Cancel
                        </button>
                      </Localized>
                    )}
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      {showForm && (
        <PurchaseOrderForm editingId={editingId} onClose={closeForm} onSaved={onSaved} />
      )}
    </div>
  );
}
