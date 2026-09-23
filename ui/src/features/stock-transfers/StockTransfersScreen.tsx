import { useState, useCallback, useEffect, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import {
  listStockTransfers,
  getStockTransfer,
  createStockTransfer,
  sendStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
  type StockTransfer,
  type StockTransferLine,
  type ReceivedLineInput,
} from '@/api/stockTransfers';
import { listProductsScoped, type ProductDto } from '@/api/products';
import { listTerminalsScoped, type TerminalDto } from '@/api/terminals';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useExitAnimation } from '@/hooks/useExitAnimation';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { SegmentedTabs, requiredLocalized, type RequiredLocalizedL10n } from '@/components';
import { l10nErrorMessage } from '@/utils/app-error';
import './StockTransfersScreen.css';

const STATUS_FILTERS = ['all', 'draft', 'pending', 'in_transit', 'received', 'cancelled'] as const;

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
}

/**
 * Localized status badge label. Prefers the Fluent `stock-transfers-status-*`
 * bundle entries (already used by the filter tabs); falls back to the
 * capitalized raw status for unknown statuses.
 */
function localizedStatusLabel(l10n: RequiredLocalizedL10n, status: string): string {
  return l10n.getString(`stock-transfers-status-${status}`) ?? statusLabel(status);
}

/**
 * One settled read. `ok: false` records that the call NEVER ANSWERED — which
 * is a different fact from "answered, and the answer was an empty list". The
 * shape is the sanctioned boot idiom (app/AppShell.tsx:87-94), and
 * the part that matters is what the caller does with `ok: false`: NOTHING, so
 * the picker keeps its UNKNOWN state instead of being overwritten with a
 * plausible empty catalogue.
 */
type Read<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(label: string, read: Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[stock-transfers] ${label} read failed — recording unknown:`, err);
    return { ok: false };
  }
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  // toLocaleString (not toLocaleDateString) so hour/minute options are honored,
  // formatted in the active Fluent locale rather than the browser default.
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface LineFormEntry {
  sku: string;
  productName: string;
  qty: string;
}

/** Stock transfers screen — create, send, receive, and cancel stock transfers between store locations or terminals. */
export default function StockTransfersScreen() {
  const { l10n } = useLocalization();
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Detail view
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ transfer: StockTransfer; lines: StockTransferLine[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createSourceLoc, setCreateSourceLoc] = useState('');
  const [createDestLoc, setCreateDestLoc] = useState('');
  const [createSourceTerminalId, setCreateSourceTerminalId] = useState('');
  const [createDestTerminalId, setCreateDestTerminalId] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createLines, setCreateLines] = useState<LineFormEntry[]>([]);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createPanelRef = useRef<HTMLDivElement>(null);

  // Receive modal
  const [receiveTransferId, setReceiveTransferId] = useState<string | null>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
  const [receiveSaving, setReceiveSaving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const receivePanelRef = useRef<HTMLDivElement>(null);

  // ── Exit animations ───────────────────────────────────────────
  const detailExit = useExitAnimation(detailId !== null, () => { setDetailId(null); setDetail(null); });
  const createExit = useExitAnimation(showCreate, () => { setShowCreate(false); resetCreateForm(); });
  const receiveExit = useExitAnimation(receiveTransferId !== null, () => setReceiveTransferId(null));

  // Cancel state
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Products & terminals for dropdowns. `null` = UNKNOWN (the read never
  // answered), `[]` = the read answered and this store really has none.
  // Collapsing the two is what let an unreachable catalogue impersonate an
  // empty one: the SKU picker came up blank, nothing matched, and the only
  // message on screen was "add at least one line item".
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [terminals, setTerminals] = useState<TerminalDto[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, prodRead, termRead] = await Promise.all([
        listStockTransfers(sessionToken),
        settle('listProductsScoped', listProductsScoped(sessionToken)),
        settle('listTerminalsScoped', listTerminalsScoped(sessionToken)),
      ]);
      setTransfers(data);
      // Only an ANSWER is written. A throw writes nothing, so the dropdowns
      // stay UNKNOWN and the notices below can say so out loud.
      if (prodRead.ok) setProducts(prodRead.value);
      if (termRead.ok) setTerminals(termRead.value);
    } catch {
      setError(l10n.getString('stock-transfers-error-load'));
    } finally {
      setLoading(false);
    }
  }, [l10n, sessionToken]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    try {
      const data = await getStockTransfer(sessionToken, id);
      if (data) setDetail(data);
    } catch {
      setError(l10n.getString('stock-transfers-error-load'));
    } finally {
      setDetailLoading(false);
    }
  }, [l10n, sessionToken]);

  const closeDetail = useCallback(() => {
    detailExit.requestClose();
  }, [detailExit]);

  const openSend = useCallback(async () => {
    if (!detailId) return;
    try {
      await sendStockTransfer(sessionToken, detailId);
      await load();
      if (detailId) openDetail(detailId);
    } catch {
      setError(l10n.getString('stock-transfers-error-send'));
    }
  }, [detailId, load, openDetail, l10n, sessionToken]);

  const openReceiveModal = useCallback(() => {
    if (!detailId || !detail) return;
    setReceiveTransferId(detailId);
    const init: Record<string, string> = {};
    detail.lines.forEach((l) => { init[l.id] = String(l.qty); });
    setReceiveLines(init);
  }, [detailId, detail]);

  const closeReceive = useCallback(() => {
    receiveExit.requestClose();
  }, [receiveExit]);

  const handleReceive = useCallback(async () => {
    if (!receiveTransferId || !sessionToken) return;
    // ST-03: received quantities are whole units — reject fractional input
    // instead of silently truncating it via parseInt.
    for (const qtyStr of Object.values(receiveLines)) {
      const qty = Number(qtyStr);
      if (!Number.isInteger(qty) || qty < 0) {
        setReceiveError(l10n.getString('stock-transfers-error-qty-integer'));
        return;
      }
    }
    setReceiveSaving(true);
    try {
      const receivedLines: ReceivedLineInput[] = Object.entries(receiveLines).map(
        ([lineId, qtyStr]) => ({
          line_id: lineId,
          received_qty: qtyStr === '' ? 0 : Number(qtyStr),
        }),
      );
      await receiveStockTransfer(sessionToken, receiveTransferId, receivedLines);
      setReceiveTransferId(null);
      await load();
      if (detailId) openDetail(detailId);
    } catch {
      setError(l10n.getString('stock-transfers-error-receive'));
    } finally {
      setReceiveSaving(false);
    }
  }, [receiveTransferId, receiveLines, sessionToken, detailId, load, openDetail, l10n]);

  const handleCancel = useCallback(async (id: string) => {
    setCancelling(id);
    try {
      await cancelStockTransfer(sessionToken, id);
      await load();
      if (detailId === id) closeDetail();
    } catch {
      setError(l10n.getString('stock-transfers-error-cancel'));
    } finally {
      setCancelling(null);
    }
  }, [load, detailId, closeDetail, l10n, sessionToken]);

  const addLineEntry = useCallback(() => {
    setCreateLines([...createLines, { sku: '', productName: '', qty: '1' }]);
  }, [createLines]);

  const updateLineEntry = useCallback((index: number, field: keyof LineFormEntry, value: string) => {
    const updated = [...createLines];
    if (field === 'sku') {
      const match = products?.find((p) => p.sku === value);
      updated[index] = { ...updated[index], sku: value, productName: match?.name ?? value } as LineFormEntry;
    } else {
      updated[index] = { ...updated[index], [field]: value } as LineFormEntry;
    }
    setCreateLines(updated);
  }, [createLines, products]);

  const removeLineEntry = useCallback((index: number) => {
    setCreateLines(createLines.filter((_, i) => i !== index));
  }, [createLines]);
  const resetCreateForm = useCallback(() => {
    setCreateSourceLoc('');
    setCreateDestLoc('');
    setCreateSourceTerminalId('');
    setCreateDestTerminalId('');
    setCreateNotes('');
    // Start with one empty line row (mirrors PurchaseOrderForm) so the
    // SKU/qty inputs are immediately editable on open.
    setCreateLines([{ sku: '', productName: '', qty: '1' }]);
    setCreateError(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!sessionToken) return;
    setCreateSaving(true);
    setCreateError(null);
    try {
      // ST-04: line quantities are whole units — reject fractional input
      // instead of silently truncating it via parseInt.
      const validLines = createLines.filter((l) => l.sku.trim());
      const invalidQty = validLines.some((l) => {
        const qty = Number(l.qty);
        return !Number.isInteger(qty) || qty <= 0;
      });
      if (invalidQty) {
        setCreateError(l10n.getString('stock-transfers-error-qty-integer'));
        setCreateSaving(false);
        return;
      }
      const lines = validLines.map((l) => ({
        id: '',
        transfer_id: '',
        sku: l.sku.trim(),
        product_name: l.productName,
        qty: Number(l.qty),
        received_qty: 0,
      }));
      if (lines.length === 0) {
        setCreateError(l10n.getString('stock-transfers-error-no-lines'));
        setCreateSaving(false);
        return;
      }
      await createStockTransfer(
        sessionToken,
        createSourceLoc || null,
        createDestLoc || null,
        createSourceTerminalId || null,
        createDestTerminalId || null,
        createNotes,
        lines,
      );
      setShowCreate(false);
      resetCreateForm();
      await load();
    } catch (err) {
      setCreateError(l10nErrorMessage(err, l10n, 'stock-transfers-error-create'));
    } finally {
      setCreateSaving(false);
    }
  }, [sessionToken, createLines, createSourceLoc, createDestLoc, createSourceTerminalId, createDestTerminalId, createNotes, l10n, load, resetCreateForm]);


  const openCreate = useCallback(() => {
    resetCreateForm();
    setShowCreate(true);
  }, [resetCreateForm]);

  const closeCreate = useCallback(() => {
    createExit.requestClose();
  }, [createExit]);

  // ── Focus traps for modals ─────────────────────────────────────
  // Deactivate detail trap while receive modal is open so Escape only
  // closes the top-most modal instead of all active modals.
  const detailTrapActive = detailId !== null && !detailExit.exiting && !detailLoading && receiveTransferId === null;
  useFocusTrap(detailPanelRef, detailTrapActive, closeDetail);
  useFocusTrap(createPanelRef, showCreate && !createExit.exiting && !createSaving, closeCreate);
  useFocusTrap(receivePanelRef, receiveTransferId !== null && !receiveExit.exiting && !receiveSaving, closeReceive);

  const filtered = statusFilter === 'all'
    ? transfers
    : transfers.filter((t) => t.status === statusFilter);

  return (
    <div className="stock-transfers">
      <div className="stock-transfers-header">
        <Localized id="stock-transfers-title">
          <h1 className="stock-transfers-title">Stock Transfers</h1>
        </Localized>
        <Localized id="stock-transfers-create">
          <Button onClick={openCreate}>New Transfer</Button>
        </Localized>
      </div>

      <SegmentedTabs
        className="stock-transfers-filters"
        ariaLabel={l10n.getString('stock-transfers-filter-aria')}
        items={STATUS_FILTERS.map((s) => ({
          value: s,
          label: (
            <Localized id={`stock-transfers-status-${s}`}>
              <span>{statusLabel(s)}</span>
            </Localized>
          ),
          ariaLabel: l10n.getString(`stock-transfers-status-${s}`),
        }))}
        activeValue={statusFilter}
        onSelect={setStatusFilter}
      />

      {loading ? (
        <div className="stock-transfers-loading-skeleton" aria-hidden="true">
          <div className="stock-transfers-header">
            <Skeleton variant="block" width="12rem" height="1.75rem" />
            <Skeleton variant="block" width="8rem" height="2.25rem" />
          </div>
          <div className="stock-transfers-filters-skeleton">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} variant="block" width="5rem" height="1.75rem" style={{ borderRadius: 'var(--radius-full)' }} />
            ))}
          </div>
          <div className="stock-transfers-table-wrap">
            <table className="stock-transfers-table" aria-hidden="true">
              <thead>
                <tr>
                  {['Transfer #', 'Status', 'Source', 'Destination', 'Created', ''].map((_, i) => (
                    <th key={i}><Skeleton variant="text" width={i < 5 ? '5rem' : '3rem'} height="0.75rem" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>{[0, 1, 2, 3].map((r) => (
                  <tr key={r}>
                    <td><Skeleton variant="text" width="5rem" height="0.875rem" /></td>
                    <td><Skeleton variant="block" width="4.5rem" height="1.125rem" style={{ borderRadius: 'var(--radius-full)' }} /></td>
                    <td><Skeleton variant="text" width="7rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="7rem" height="0.875rem" /></td>
                    <td><Skeleton variant="text" width="8rem" height="0.75rem" /></td>
                    <td className="stock-transfers-cell-actions">
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                      <Skeleton variant="block" width="3.5rem" height="1.375rem" />
                    </td>
                  </tr>
                ))}
</tbody>
            </table>
          </div>
        </div>
      ) : error ? (
        <Card shadow="sm">
          <div className="stock-transfers-empty">
            <p className="stock-transfers-error-text">{error}</p>
            <Button variant="secondary" onClick={load}>
              <Localized id="retry">Retry</Localized>
            </Button>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card shadow="sm">
          <div className="stock-transfers-empty">
            <Localized id="stock-transfers-empty">
              <p>No stock transfers found</p>
            </Localized>
          </div>
        </Card>
      ) : (
        <div className="stock-transfers-table-wrap">
          <table className="stock-transfers-table" aria-label={l10n.getString('stock-transfers-table-aria')}>
            <thead>
              <tr>
                <Localized id="stock-transfers-number"><th>Transfer #</th></Localized>
                <Localized id="stock-transfers-status"><th>Status</th></Localized>
                <Localized id="stock-transfers-source"><th>Source</th></Localized>
                <Localized id="stock-transfers-destination"><th>Destination</th></Localized>
                <Localized id="stock-transfers-created"><th>Created</th></Localized>
                <Localized id="stock-transfers-actions" attrs={{ 'aria-label': true }}>
                  <th aria-label={l10n.getString('actions-aria')}> </th>
                </Localized>
              </tr>
            </thead>
            <tbody>{filtered.map((t) => (
                <tr key={t.id}>
                  <td className="stock-transfers-cell-number">
                    <button
                      type="button"
                      className="stock-transfers-link"
                      onClick={() => openDetail(t.id)}
                    >
                      {t.transfer_number}
                    </button>
                  </td>
                  <td>
                    <span className={`stock-transfers-badge stock-transfers-badge--${t.status}`}>
                      {localizedStatusLabel(l10n, t.status)}
                    </span>
                  </td>
                  <td>{t.source_location ?? t.source_terminal_id ?? '—'}</td>
                  <td>{t.destination_location ?? t.destination_terminal_id ?? '—'}</td>
                  <td className="stock-transfers-cell-date">{formatDate(t.created_at, numLocale)}</td>
                  <td className="stock-transfers-cell-actions">
                    <Localized id="stock-transfers-view">
                      <button
                        type="button"
                        className="stock-transfers-action-btn"
                        onClick={() => openDetail(t.id)}
                      >
                        View
                      </button>
                    </Localized>
                    {(t.status === 'draft' || t.status === 'pending') && (
                      <button
                        type="button"
                        className="stock-transfers-action-btn stock-transfers-action-btn--danger"
                        disabled={cancelling === t.id}
                        aria-label={l10n.getString('stock-transfers-cancel')}
                        onClick={() => handleCancel(t.id)}
                      >
                        <Localized id="stock-transfers-cancel">
                          <span>Cancel</span>
                        </Localized>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
</tbody>
          </table>
        </div>
      )}

      {/* ── Detail Modal ─────────────────────────────────────────── */}
      {detailExit.shouldRender && (
        <div className={`stock-transfers-overlay${detailExit.exiting ? ' stock-transfers-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('stock-transfers-detail-aria')}>
          <div className={`stock-transfers-modal stock-transfers-modal--wide${detailExit.exiting ? ' stock-transfers-modal--exiting' : ''}`} ref={detailPanelRef}>
            <div className="stock-transfers-modal-header">
              <Localized id="stock-transfers-detail-title">
                <h2>Transfer Details</h2>
              </Localized>
              <button type="button" className="stock-transfers-modal-close" onClick={closeDetail} aria-label={l10n.getString('close')}>&times;</button>
            </div>
            {detailLoading ? (
              <div className="stock-transfers-detail-skeleton" aria-hidden="true">
                <div className="stock-transfers-detail-info">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="stock-transfers-detail-field">
                      <Skeleton width="3rem" height="0.75rem" />
                      <Skeleton width="80%" height="0.875rem" />
                    </div>
                  ))}
                </div>
                <table className="stock-transfers-lines-table" aria-hidden="true">
                  <thead>
                    <tr>
                      {['SKU', 'Product', 'Qty', 'Received'].map((_, i) => (
                        <th key={i}><Skeleton width="3rem" height="0.75rem" /></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{Array.from({ length: 4 }, (_, r) => (
                      <tr key={r}>
                        <td><Skeleton width="4rem" height="0.875rem" /></td>
                        <td><Skeleton width="6rem" height="0.875rem" /></td>
                        <td><Skeleton width="2rem" height="0.875rem" /></td>
                        <td><Skeleton width="2rem" height="0.875rem" /></td>
                      </tr>
                    ))}
</tbody>
                </table>
                <div className="stock-transfers-detail-actions">
                  <Skeleton variant="block" width="7rem" height="2rem" style={{ borderRadius: 'var(--radius-lg)' }} />
                </div>
              </div>
            ) : detail ? (
              <div className="stock-transfers-detail">
                <div className="stock-transfers-detail-info">
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-number"><span className="stock-transfers-detail-label">Transfer #</span></Localized>
                    <span>{detail.transfer.transfer_number}</span>
                  </div>
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-status"><span className="stock-transfers-detail-label">Status</span></Localized>
                    <span className={`stock-transfers-badge stock-transfers-badge--${detail.transfer.status}`}>{localizedStatusLabel(l10n, detail.transfer.status)}</span>
                  </div>
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-source"><span className="stock-transfers-detail-label">Source</span></Localized>
                    <span>{detail.transfer.source_location ?? detail.transfer.source_terminal_id ?? '—'}</span>
                  </div>
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-destination"><span className="stock-transfers-detail-label">Destination</span></Localized>
                    <span>{detail.transfer.destination_location ?? detail.transfer.destination_terminal_id ?? '—'}</span>
                  </div>
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-notes"><span className="stock-transfers-detail-label">Notes</span></Localized>
                    <span>{detail.transfer.notes || '—'}</span>
                  </div>
                  <div className="stock-transfers-detail-field">
                    <Localized id="stock-transfers-created"><span className="stock-transfers-detail-label">Created</span></Localized>
                    <span>{formatDate(detail.transfer.created_at, numLocale)}</span>
                  </div>
                  {detail.transfer.sent_at && (
                    <div className="stock-transfers-detail-field">
                      <Localized id="stock-transfers-sent-at"><span className="stock-transfers-detail-label">Sent</span></Localized>
                      <span>{formatDate(detail.transfer.sent_at, numLocale)}</span>
                    </div>
                  )}
                  {detail.transfer.received_at && (
                    <div className="stock-transfers-detail-field">
                      <Localized id="stock-transfers-received-at"><span className="stock-transfers-detail-label">Received</span></Localized>
                      <span>{formatDate(detail.transfer.received_at, numLocale)}</span>
                    </div>
                  )}
                </div>

                <table className="stock-transfers-lines-table" aria-label={l10n.getString('stock-transfers-lines-aria')}>
                  <thead>
                    <tr>
                      <Localized id="stock-transfers-sku"><th>SKU</th></Localized>
                      <Localized id="stock-transfers-product"><th>Product</th></Localized>
                      <Localized id="stock-transfers-qty"><th>Qty</th></Localized>
                      <Localized id="stock-transfers-received"><th>Received</th></Localized>
                    </tr>
                  </thead>
                  <tbody>{detail.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.sku}</td>
                        <td>{l.product_name}</td>
                        <td>{l.qty}</td>
                        <td>{l.received_qty}</td>
                      </tr>
                    ))}
</tbody>
                </table>

                <div className="stock-transfers-detail-actions">
                  {(detail.transfer.status === 'draft' || detail.transfer.status === 'pending') && (
                    <>
                      <Localized id="stock-transfers-send">
                        <Button variant="primary" onClick={openSend}>Send Transfer</Button>
                      </Localized>
                      <Localized id="stock-transfers-cancel">
                        <Button variant="danger" onClick={() => handleCancel(detail.transfer.id)}>Cancel Transfer</Button>
                      </Localized>
                    </>
                  )}
                  {detail.transfer.status === 'in_transit' && (
                    <Localized id="stock-transfers-receive">
                      <Button variant="primary" onClick={openReceiveModal}>Receive Transfer</Button>
                    </Localized>
                  )}
                  <Localized id="close">
                    <Button variant="ghost" onClick={closeDetail}>Close</Button>
                  </Localized>
                </div>
              </div>
            ) : (
              <Localized id="stock-transfers-not-found">
                <p>Transfer not found</p>
              </Localized>
            )}
          </div>
        </div>
      )}

      {/* ── Create Modal ─────────────────────────────────────────── */}
      {createExit.shouldRender && (
        <div className={`stock-transfers-overlay${createExit.exiting ? ' stock-transfers-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('stock-transfers-create-aria')}>
          <div className={`stock-transfers-modal stock-transfers-modal--wide${createExit.exiting ? ' stock-transfers-modal--exiting' : ''}`} ref={createPanelRef}>
            <div className="stock-transfers-modal-header">
              <Localized id="stock-transfers-create-title">
                <h2>New Stock Transfer</h2>
              </Localized>
              <button type="button" className="stock-transfers-modal-close" onClick={closeCreate} aria-label={l10n.getString('close')}>&times;</button>
            </div>
            <div className="stock-transfers-modal-body">
              <div className="stock-transfers-form-row">
                <div className="stock-transfers-field">
                  <Localized id="stock-transfers-source"><span className="stock-transfers-label">Source</span></Localized>
                  <input id="st-source-location" className="stock-transfers-input" type="text" value={createSourceLoc} onChange={(e) => setCreateSourceLoc(e.target.value)} placeholder={l10n.getString('stock-transfers-source-placeholder')} aria-label={l10n.getString('stock-transfers-source')} />
                </div>
                <div className="stock-transfers-field">
                  <Localized id="stock-transfers-destination"><span className="stock-transfers-label">Destination</span></Localized>
                  <input id="st-dest-location" className="stock-transfers-input" type="text" value={createDestLoc} onChange={(e) => setCreateDestLoc(e.target.value)} placeholder={l10n.getString('stock-transfers-destination-placeholder')} aria-label={l10n.getString('stock-transfers-destination')} />
                </div>
              </div>
              <div className="stock-transfers-form-row">
                <label className="stock-transfers-field" htmlFor="st-source-terminal">
                  <Localized id="stock-transfers-source-terminal"><span className="stock-transfers-label">Source Terminal (optional)</span></Localized>
                  <select id="st-source-terminal" className="stock-transfers-input" value={createSourceTerminalId} onChange={(e) => setCreateSourceTerminalId(e.target.value)}>
                    <option value="">—</option>
                    {(terminals ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label className="stock-transfers-field" htmlFor="st-dest-terminal">
                  <Localized id="stock-transfers-destination-terminal"><span className="stock-transfers-label">Destination Terminal (optional)</span></Localized>
                  <select id="st-dest-terminal" className="stock-transfers-input" value={createDestTerminalId} onChange={(e) => setCreateDestTerminalId(e.target.value)}>
                    <option value="">—</option>
                    {(terminals ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              {terminals === null && !loading && (
                // NOT an empty terminal list — a terminal list nobody read.
                <div className="stock-transfers-error" role="alert">
                  {requiredLocalized(l10n, 'terminal-error-load')}
                </div>
              )}
              <div className="stock-transfers-field">
                <Localized id="stock-transfers-notes"><span className="stock-transfers-label">Notes</span></Localized>
                <textarea id="st-notes" className="stock-transfers-input stock-transfers-textarea" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={2} aria-label={l10n.getString('stock-transfers-notes')} />
              </div>

              <div className="stock-transfers-lines-section">
                <div className="stock-transfers-lines-header">
                  <Localized id="stock-transfers-lines">
                    <span className="stock-transfers-label">Line Items</span>
                  </Localized>
                  <Localized id="stock-transfers-add-line">
                    <Button variant="secondary" size="sm" onClick={addLineEntry}>Add Line</Button>
                  </Localized>
                </div>
                {createLines.map((line, i) => (
                  <div key={i} className="stock-transfers-line-row">
                    <input
                      className="stock-transfers-input stock-transfers-line-sku"
                      type="text"
                      list="product-skus"
                      value={line.sku}
                      onChange={(e) => updateLineEntry(i, 'sku', e.target.value)}
                      placeholder={l10n.getString('stock-transfers-sku-placeholder')}
                      aria-label={l10n.getString('stock-transfers-sku')}
                    />
                    <input
                      className="stock-transfers-input stock-transfers-line-name"
                      type="text"
                      value={line.productName}
                      onChange={(e) => updateLineEntry(i, 'productName', e.target.value)}
                      placeholder={l10n.getString('stock-transfers-product-placeholder')}
                      aria-label={l10n.getString('stock-transfers-product')}
                    />
                    <input
                      className="stock-transfers-input stock-transfers-line-qty"
                      type="number"
                      min="1"
                      value={line.qty}
                      onChange={(e) => updateLineEntry(i, 'qty', e.target.value)}
                      aria-label={l10n.getString('stock-transfers-qty')}
                    />
                    <button type="button" className="stock-transfers-line-remove" onClick={() => removeLineEntry(i)} aria-label={l10n.getString('stock-transfers-remove-line')}>&times;</button>
                  </div>
                ))}
                <datalist id="product-skus">
                  {(products ?? []).map((p) => <option key={p.sku} value={p.sku} />)}
                </datalist>
                {products === null && !loading && (
                  // The SKU box looks the same whether this store has no
                  // products or the catalogue was unreachable. Say which.
                  <div className="stock-transfers-error" role="alert">
                    {requiredLocalized(l10n, 'retail-load-error-unavailable')}
                  </div>
                )}
              </div>

              {createError && <div className="stock-transfers-error" role="alert">{createError}</div>}
            </div>
            <div className="stock-transfers-modal-actions">
              <Localized id="cancel">
                <Button variant="ghost" onClick={closeCreate} disabled={createSaving}>Cancel</Button>
              </Localized>
              <Button variant="primary" loading={createSaving} onClick={handleCreate}>
                <Localized id="stock-transfers-create-action"><span>Create Transfer</span></Localized>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receive Modal ────────────────────────────────────────── */}
      {receiveExit.shouldRender && detail && (
        <div className={`stock-transfers-overlay${receiveExit.exiting ? ' stock-transfers-overlay--exiting' : ''}`} role="dialog" aria-modal="true" aria-label={l10n.getString('stock-transfers-receive-aria')}>
          <div className={`stock-transfers-modal${receiveExit.exiting ? ' stock-transfers-modal--exiting' : ''}`} ref={receivePanelRef}>
            <div className="stock-transfers-modal-header">
              <Localized id="stock-transfers-receive-title">
                <h2>Receive Transfer</h2>
              </Localized>
              <button type="button" className="stock-transfers-modal-close" onClick={closeReceive} aria-label={l10n.getString('close')}>&times;</button>
            </div>
            <div className="stock-transfers-modal-body">
              <Localized id="stock-transfers-receive-instruction">
                <p>Enter the quantity received for each line item.</p>
              </Localized>
              {receiveError && <div className="stock-transfers-error" role="alert">{receiveError}</div>}
              {detail.lines.map((l) => (
                <label key={l.id} className="stock-transfers-field">
                  <Localized id="stock-transfers-receive-line" vars={{ sku: l.sku, product: l.product_name, qty: String(l.qty) }}>
                    <span className="stock-transfers-label">{l.sku} — {l.product_name} (ordered: {l.qty})</span>
                  </Localized>
                  <Localized id="stock-transfers-received-qty-aria" attrs={{ 'aria-label': true }} vars={{ sku: l.sku }}>
                    <input
                      className="stock-transfers-input"
                      type="number"
                      min="0"
                      max={l.qty}
                      value={receiveLines[l.id] ?? String(l.qty)}
                      onChange={(e) => setReceiveLines((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      aria-label={`${l.sku} received quantity`}
                    />
                  </Localized>
                </label>
              ))}
            </div>
            <div className="stock-transfers-modal-actions">
              <Localized id="cancel">
                <Button variant="ghost" onClick={closeReceive} disabled={receiveSaving}>Cancel</Button>
              </Localized>
              <Button variant="primary" loading={receiveSaving} onClick={handleReceive}>
                <Localized id="stock-transfers-receive-action"><span>Confirm Receipt</span></Localized>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
