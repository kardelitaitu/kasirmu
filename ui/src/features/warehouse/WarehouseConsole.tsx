// ── ui/src/features/warehouse/WarehouseConsole.tsx ───────────────────────
// Warehouse POS console — barcode-first daily operations screen.
// Self-contained (copied structure from retail POS, no shared imports from
// features/retail or features/sales). Modes: RECEIVE / SEND / COUNT / STOCK.
//
// Phase 1 scope: console shell, scan input, session panel, F-key bar with
// popup sessions, and the core SEND / RECEIVE (transfer) flows reusing the
// existing stock_transfers commands. COUNT and STOCK tabs are shells.

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocalization } from '@fluent/react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useFullscreen } from '@/hooks/useFullscreen';
import { SegmentedTabs, requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import { asArray } from '@/utils/ipc-payload';
import { isTabletShell } from '@/utils/shellKind';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';

import { listWarehouseProductsAtLocation, type ProductDto } from '@/api/products';
import {
  createStockTransfer,
  addStockTransferLine,
  sendStockTransfer,
  receiveStockTransfer,
  listInTransitTransfers,
  type StockTransferLine,
  type ReceivedLineInput,
} from '@/api/stockTransfers';

import LocationPicker from '@/features/inventory/LocationPicker';
import { useWarehouseSession, type WarehouseMode } from './useWarehouseSession';
import { useWarehouseScanner } from './useWarehouseScanner';
import WarehouseFnBar from './WarehouseFnBar';
import { WAREHOUSE_SHORTCUTS, ACTIVE_SHORTCUT_ACTIONS } from './warehouseShortcuts';
import { listPurchaseOrdersScoped, receivePurchaseOrderWithLinesScoped, type PurchaseOrderDto } from '@/api/purchasing';
import WarehouseCountFlow from './WarehouseCountFlow';
import './WarehouseConsole.css';

interface PendingTransferPick {
  id: string;
  number: string;
  source: string | null;
  lines: StockTransferLine[];
}

/**
 * Warehouse console — the daily operations screen for a warehouse workspace.
 * Phase 1: receive-via-transfer and send (pick-verify) are functional; count
 * and stock modes render the existing stock table.
 */
/** Every warehouse mode, in tab order. */
const WAREHOUSE_MODES: WarehouseMode[] = ['receive', 'send', 'count', 'stock'];

/**
 * Whether this shell can run a warehouse mode.
 *
 * `count` is desktop-only, and the reason is measured (2026-10-25): the counting
 * flow loads its lines with `list_warehouse_products_at_location`
 * (WarehouseCountFlow.tsx:125), which apps/desktop-tauri registers at lib.rs:1613 and
 * apps/mobile-tauri does NOT register at all -- the tablet has only
 * `list_warehouse_products_scoped` (mobile lib.rs:1381), which takes no location id
 * and therefore cannot answer 'stock AT THIS location'. Substituting it would show
 * counts from the wrong scope on a screen whose whole job is accuracy, so the mode is
 * withheld rather than degraded. The route itself stays: receive/send/stock do not
 * call the missing command.
 *
 * Withheld at the TAB list rather than at the render, so the tab is absent instead of
 * present-and-broken -- the C47 idiom.
 */
function warehouseModeAvailable(mode: WarehouseMode): boolean {
  if (mode === 'count' && isTabletShell()) return false;
  return true;
}

export default function WarehouseConsole() {
  const { l10n } = useLocalization();
  const { addToast } = useToast();
  const { sessionToken: rawToken, activeInstance } = useWorkspace();
  const sessionToken = rawToken ?? '';
  const instanceId = activeInstance?.instance_id ?? '';
  const session = useWarehouseSession();
  const { toggleFullscreen } = useFullscreen();

  // Shared by the FnBar button and the keydown case, so Shift-less F5 / ? cannot
  // diverge from the buttons that advertise them. Both were keyboard-dead no-ops.
  const handlePrint = useCallback(() => {
    addToast({ type: 'info', message: 'Print' });
  }, [addToast]);
  const handleShowHelp = useCallback(() => {
    addToast({ type: 'info', message: '?' });
  }, [addToast]);

  const [mode, setMode] = useState<WarehouseMode>('receive');
  const [locationId, setLocationId] = useState('');
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // True when this shell cannot answer the per-location stock read at all (tablet).
  // Distinct from loadError, which means the read was attempted and failed.
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [scanInput, setScanInput] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Popup sessions (F1 receive / F2 send) — persistent, independent state.
  const [receivePopupOpen, setReceivePopupOpen] = useState(false);
  const [sendPopupOpen, setSendPopupOpen] = useState(false);

  // Dialogs
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransferPick | null>(null);
  const [transferListOpen, setTransferListOpen] = useState(false);
  const [inTransit, setInTransit] = useState<PendingTransferPick[]>([]);
  // A failed list read must not render as "there are none". The dialog's empty state is
  // an authoritative claim, so it needs to know the difference between an answered
  // empty list and a read that never answered.
  const [inTransitFailed, setInTransitFailed] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);

  // PO receive (Phase 2)
  const [pendingPo, setPendingPo] = useState<PurchaseOrderDto | null>(null);
  const [poListOpen, setPoListOpen] = useState(false);
  const [poList, setPoList] = useState<PurchaseOrderDto[]>([]);
  const [poListFailed, setPoListFailed] = useState(false);

  // ── Products for the bound location ────────────────────────────────
  const loadProducts = useCallback(async () => {
    if (!sessionToken || !locationId) {
      setProducts([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    // POSITIVE/ELSE, not an early return: `list_warehouse_products_at_location` is
    // desktop-only (apps/desktop-tauri lib.rs:1613; apps/mobile-tauri registers only
    // `list_warehouse_products_scoped`, which has no location id). Unguarded, every
    // tablet visit to Warehouse landed in the catch and rendered 'could not load'
    // over an empty grid -- a failure state for a shell that simply has no answer.
    // The tablet reports the honest unavailable state instead, and the `else` arm is
    // the shape verify-scoped-reads.py reads as a guard.
    if (isTabletShell()) {
      setProducts([]);
      setLoadUnavailable(true);
      setLoading(false);
      return;
    } else {
    try {
      // asArray: the render maps `products` (see utils/ipc-payload).
      const data = await listWarehouseProductsAtLocation(sessionToken, locationId);
      setProducts(asArray<typeof data[number]>(data));
    } catch (err) {
      setLoadError(l10nErrorMessage(err, l10n, 'warehouse-load-error'));
    } finally {
      setLoading(false);
    }
    }
  }, [sessionToken, locationId, l10n]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts, refreshKey]);

  // ── Scan → add to active session ───────────────────────────────────
  const resolveScan = useCallback(
    async (code: string) => {
      const q = code.trim();
      if (!q) return;
      // Prefer exact barcode match, then SKU match.
      const product =
        products.find((p) => p.barcode === q) ?? products.find((p) => p.sku === q);
      if (!product) {
        addToast({ type: 'warning', message: requiredLocalized(l10n, 'warehouse-scan-no-match') });
        return;
      }
      session.addLine(product.sku, product.name, product.rack_location ?? null);
      // In SEND mode, a scan counts as a pick-verify of the newest line.
      if (session.mode === 'send') {
        const line = session.lines.find((l) => l.sku === product.sku);
        if (line) session.pickLine(line.id, line.pickedQty + 1);
      }
      setRefreshKey((k) => k + 1);
    },
    [products, session, l10n, addToast],
  );

  const handleScanSubmit = useCallback(() => {
    void resolveScan(scanInput);
    setScanInput('');
    scanInputRef.current?.focus();
  }, [resolveScan, scanInput]);

  useWarehouseScanner({
    onProductFound: (payload) => void resolveScan(payload.code),
    onProductNotFound: () =>
      addToast({ type: 'warning', message: requiredLocalized(l10n, 'warehouse-scan-no-match') }),
  });

  // ── In-transit transfers for receive ───────────────────────────────
  const loadInTransit = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const list = await listInTransitTransfers(sessionToken);
      setInTransit(
        list.map((t) => ({
          id: t.transfer.id,
          number: t.transfer.transfer_number,
          source: t.transfer.source_location,
          lines: t.lines,
        })),
      );
      setInTransitFailed(false);
    } catch {
      // NOT "the dialog shows the empty state" — that would tell the operator there is
      // nothing in transit on the strength of a read that never answered.
      setInTransit([]);
      setInTransitFailed(true);
    }
  }, [sessionToken]);

  // ── Complete SEND ──────────────────────────────────────────────────
  const completeSend = useCallback(async () => {
    if (!sessionToken || session.isEmpty || !session.destinationLocationId) return;
    try {
      const created = await createStockTransfer(
        sessionToken,
        locationId || null,
        session.destinationLocationId,
        null,
        null,
        '',
        [],
      );
      for (const line of session.lines) {
        await addStockTransferLine(
          sessionToken,
          created.id,
          line.sku,
          line.productName,
          line.qty,
        );
      }
      const sent = await sendStockTransfer(sessionToken, created.id);
      addToast({
        type: 'success',
        message: requiredLocalized(l10n, 'warehouse-send-confirmed', {
          number: sent.transfer_number,
          count: String(session.itemCount),
          destination: session.destinationLocationId,
        }),
      });
      session.clear();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addToast({ type: 'error', message: l10nErrorMessage(err, l10n, 'warehouse-adjust-error') });
    }
  }, [sessionToken, session, locationId, l10n, addToast]);

  // ── Complete RECEIVE (transfer) ────────────────────────────────────
  const completeReceive = useCallback(async () => {
    if (!sessionToken || session.isEmpty || !session.transferId) return;
    try {
      const receivedLines: ReceivedLineInput[] = session.lines
        .filter((l) => l.transferLineId)
        .map((l) => ({
          line_id: l.transferLineId!,
          received_qty: l.qty,
        }));
      const received = await receiveStockTransfer(sessionToken, session.transferId, receivedLines);
      addToast({
        type: 'success',
        message: requiredLocalized(l10n, 'warehouse-receive-confirmed', {
          number: received.transfer_number,
          count: String(session.itemCount),
        }),
      });
      session.clear();
      setReceivePopupOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addToast({ type: 'error', message: l10nErrorMessage(err, l10n, 'warehouse-adjust-error') });
    }
  }, [sessionToken, session, l10n, addToast]);

  // ── F-key keydown handler (single owner per key, KEY-02) ───────────
  // Focus the scan input on mount so the console is immediately scannable.
  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      const actionFor = (key: string) => {
        const s = WAREHOUSE_SHORTCUTS.find(
          (x) => x.key === key && !x.placeholder && ACTIVE_SHORTCUT_ACTIONS.has(x.action),
        );
        return s?.action;
      };

      const action = actionFor(e.key);
      if (!action) return;
      if (typing && WAREHOUSE_SHORTCUTS.find((x) => x.action === action)?.editableGuard) return;

      switch (action) {
        case 'receive-popup':
          e.preventDefault();
          setMode('receive');
          setReceivePopupOpen((v) => !v);
          break;
        case 'send-popup':
          e.preventDefault();
          setMode('send');
          setSendPopupOpen((v) => !v);
          break;
        case 'count-popup':
          e.preventDefault();
          setMode('count');
          break;
        case 'stock':
          e.preventDefault();
          setMode('stock');
          break;
        // ⚠️ These two used to `preventDefault()` and NOTHING ELSE, so F5 and ? were
        // dead keys: advertised on their FnBar buttons (below, via `onPrint` /
        // `onShowHelp`), listed in the help overlay, and silently swallowed. The
        // parity test could not catch it because its "every active shortcut has a
        // handler" claim compares `ACTIVE_SHORTCUT_ACTIONS` against the manifest that
        // DERIVES that set — A ⊆ A. Both now call the same functions the buttons call,
        // so the two paths cannot drift.
        case 'print':
          e.preventDefault();
          handlePrint();
          break;
        case 'shortcut-list':
          e.preventDefault();
          handleShowHelp();
          break;
        case 'close':
          e.preventDefault();
          setReceivePopupOpen(false);
          setSendPopupOpen(false);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // `handlePrint` / `handleShowHelp` are read by the F5 and ? cases above. Both are
    // useCallback-stable (addToast is stable), so listing them cannot churn the
    // listener — but omitting them froze the first render's closure, the stale-dep
    // shape this file's other handlers already avoid.
  }, [handlePrint, handleShowHelp]);

  // ── Pick transfer dialog handlers ──────────────────────────────────
  const openTransferList = useCallback(() => {
    void loadInTransit();
    setTransferListOpen(true);
  }, [loadInTransit]);

  const pickTransfer = useCallback(
    (t: PendingTransferPick) => {
      session.clear();
      for (const line of t.lines) {
        session.addLine(line.sku, line.product_name, null, line.qty, line.id, 'transfer');
      }
      session.setTransferId(t.id);
      setPendingTransfer(t);
      setTransferListOpen(false);
    },
    [session],
  );

  // ── PO receive (Phase 2) ──────────────────────────────────────────
  const loadApprovedPos = useCallback(async () => {
    if (!sessionToken) return;
    try {
      const all = await listPurchaseOrdersScoped(sessionToken);
      setPoList(all.filter((po) => po.status === 'approved'));
      setPoListFailed(false);
    } catch {
      setPoList([]);
      setPoListFailed(true);
    }
  }, [sessionToken]);

  const openPoList = useCallback(() => {
    void loadApprovedPos();
    setPoListOpen(true);
  }, [loadApprovedPos]);

  const pickPo = useCallback(
    (po: PurchaseOrderDto) => {
      session.clear();
      for (const line of po.lines) {
        session.addLine(line.sku, line.product_name, null, line.qty, line.id, 'po');
      }
      session.setPoId(po.id);
      setPendingPo(po);
      setPoListOpen(false);
    },
    [session],
  );

  const completeReceivePo = useCallback(async () => {
    if (!sessionToken || session.isEmpty || !session.poId) return;
    try {
      const input = session.lines
        .filter((l) => l.poLineId)
        .map((l) => ({
          line_id: l.poLineId!,
          received_qty: Math.max(0, l.qty - l.damagedQty),
          damaged_qty: l.damagedQty,
        }));
      const received = await receivePurchaseOrderWithLinesScoped(sessionToken, session.poId, input);
      addToast({
        type: 'success',
        message: requiredLocalized(l10n, 'warehouse-receive-confirmed', {
          number: received.po_number,
          count: String(session.itemCount),
        }),
      });
      session.clear();
      setPendingPo(null);
      setReceivePopupOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      addToast({ type: 'error', message: l10nErrorMessage(err, l10n, 'warehouse-adjust-error') });
    }
  }, [sessionToken, session, l10n, addToast]);

  const grid = useMemo(() => {
    const q = scanInput.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q),
    );
  }, [products, scanInput]);

  return (
    <div className="warehouse-screen">
      {/* ── Header ── */}
      <div className="warehouse-header">
        <h1 className="warehouse-title">{requiredLocalized(l10n, 'warehouse-title')}</h1>
        {instanceId && (
          <LocationPicker value={locationId} onChange={(id) => setLocationId(id)} refreshKey={refreshKey} />
        )}
      </div>

      {/* ── Mode tabs ── */}
      <SegmentedTabs
        className="warehouse-mode-tabs"
        ariaLabel={requiredLocalized(l10n, 'warehouse-mode-tabs-aria')}
        items={WAREHOUSE_MODES.filter(warehouseModeAvailable).map((m) => ({
          value: m,
          label: requiredLocalized(l10n, `warehouse-mode-${m}`),
        }))}
        activeValue={mode}
        onSelect={setMode}
      />

      {/* ── Scan input (barcode-first) ── */}
      {mode !== 'stock' && (
        <div className="warehouse-scan-row">
          <input
            ref={scanInputRef}
            className="warehouse-scan-input"
            placeholder={requiredLocalized(l10n, 'warehouse-scan-placeholder')}
            aria-label={requiredLocalized(l10n, 'warehouse-scan-aria')}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScanSubmit();
            }}
          />
          <Button variant="primary" onClick={handleScanSubmit} aria-label={requiredLocalized(l10n, 'warehouse-scan-add')}>
            {requiredLocalized(l10n, 'warehouse-scan-add')}
          </Button>
        </div>
      )}

      {!locationId && mode !== 'stock' && (
        <div className="warehouse-empty-panel">
          {requiredLocalized(l10n, 'warehouse-no-location-desc')}
        </div>
      )}

      {/* ── Main two-panel body ── */}
      {locationId && (
        <div className="warehouse-body">
          {/* Left: product grid (fallback) or count/stock content */}
          <div className="warehouse-grid-panel">
            {mode === 'stock' ? (
              <div className="warehouse-empty-panel">
                {requiredLocalized(l10n, 'warehouse-mode-stock-desc')} — Phase 1 shell
              </div>
            ) : mode === 'count' ? (
              <WarehouseCountFlow
                sessionToken={sessionToken}
                locationId={locationId}
                onCompleted={() => setRefreshKey((k) => k + 1)}
              />
            ) : loading ? (
              <>
                <Skeleton variant="block" width="100%" height="2.5rem" />
                <Skeleton variant="block" width="100%" height="2.5rem" />
                <Skeleton variant="block" width="100%" height="2.5rem" />
              </>
            ) : loadUnavailable ? (
              // Not an error: this shell has no per-location stock read, so there is
              // nothing to show and nothing to retry. A distinct state from loadError
              // keeps a shell limitation out of the failure path.
              <div className="warehouse-empty-panel" data-testid="warehouse-stock-unavailable">
                {requiredLocalized(l10n, 'warehouse-stock-desktop-only')}
              </div>
            ) : loadError ? (
              <div className="warehouse-error" role="alert">{loadError}</div>
            ) : grid.length === 0 ? (
              <div className="warehouse-empty-panel">{requiredLocalized(l10n, 'warehouse-empty-title')}</div>
            ) : (
              <div className="warehouse-grid">
                {grid.map((p) => (
                  <button
                    key={p.sku}
                    type="button"
                    className="warehouse-grid-card"
                    onClick={() => session.addLine(p.sku, p.name, p.rack_location ?? null)}
                  >
                    <span className="warehouse-grid-sku">{p.sku}</span>
                    <span className="warehouse-grid-name">{p.name}</span>
                    {p.rack_location && (
                      <span className="warehouse-grid-bin">
                        {requiredLocalized(l10n, 'warehouse-bin', { bin: p.rack_location })}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: session panel */}
          <div className="warehouse-session-panel">
            <div className="warehouse-session-lines">
              {session.isEmpty ? (
                <div className="warehouse-session-empty">
                  {requiredLocalized(l10n, 'warehouse-session-empty')}
                </div>
              ) : (
                session.lines.map((line) => (
                  <div key={line.id} className="warehouse-session-line">
                    <div className="warehouse-session-line-info">
                      <span className="warehouse-session-line-sku">{line.sku}</span>
                      <span className="warehouse-session-line-name">{line.productName}</span>
                      {line.bin && (
                        <span className="warehouse-session-line-bin">
                          {requiredLocalized(l10n, 'warehouse-bin', { bin: line.bin })}
                        </span>
                      )}
                    </div>
                    <div className="warehouse-session-line-actions">
                      <span className="warehouse-session-line-qty">× {line.qty}</span>
                      {session.mode === 'send' && (
                        <button
                          type="button"
                          className="warehouse-session-pick-btn"
                          onClick={() => session.pickLine(line.id, line.pickedQty + 1)}
                        >
                          {requiredLocalized(l10n, 'warehouse-session-line-picked')}: {line.pickedQty}/{line.qty}
                        </button>
                      )}
                      <button
                        type="button"
                        className="warehouse-session-remove"
                        aria-label={`Remove ${line.sku}`}
                        onClick={() => session.removeLine(line.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {!session.isEmpty && (
              <div className="warehouse-session-footer">
                <span className="warehouse-session-count">
                  {requiredLocalized(l10n, 'warehouse-session-items', { count: String(session.itemCount) })}
                </span>
                {session.mode === 'receive' && (
                  <>
                    {session.transferId && (
                      <Button variant="primary" onClick={completeReceive} disabled={!session.transferId}>
                        {requiredLocalized(l10n, 'warehouse-session-complete-receive')}
                      </Button>
                    )}
                    {session.poId && (
                      <Button variant="primary" onClick={completeReceivePo} disabled={!session.poId}>
                        {requiredLocalized(l10n, 'warehouse-session-complete-receive')}
                      </Button>
                    )}
                  </>
                )}
                {session.mode === 'send' && (
                  <Button
                    variant="primary"
                    onClick={completeSend}
                    disabled={!session.destinationLocationId || !session.fullyPicked}
                  >
                    {requiredLocalized(l10n, 'warehouse-session-complete-send')}
                  </Button>
                )}
                <Button variant="secondary" onClick={session.clear}>
                  {requiredLocalized(l10n, 'warehouse-session-clear')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── FnBar ── */}
      <WarehouseFnBar
        onReceive={() => { setMode('receive'); setReceivePopupOpen((v) => !v); }}
        onSend={() => { setMode('send'); setSendPopupOpen((v) => !v); }}
        onCount={() => setMode('count')}
        onStock={() => setMode('stock')}
        onPrint={handlePrint}
        onToggleFullscreen={toggleFullscreen}
        onShowHelp={handleShowHelp}
      />

      {/* ── Receive popup (F1) ── */}
      {receivePopupOpen && (
        <div className="warehouse-popup">
          <div className="warehouse-popup-head">
            <h2>{requiredLocalized(l10n, 'warehouse-popup-receive-title')}</h2>
            <button type="button" className="warehouse-popup-close" onClick={() => setReceivePopupOpen(false)}>
              {requiredLocalized(l10n, 'warehouse-popup-close')}
            </button>
          </div>
          <div className="warehouse-popup-body">
            <div className="warehouse-popup-source-row">
              <Button variant="secondary" onClick={openTransferList}>
                {requiredLocalized(l10n, 'warehouse-receive-source-transfer')}
              </Button>
              <Button variant="secondary" onClick={openPoList}>
                {requiredLocalized(l10n, 'warehouse-receive-source-po')}
              </Button>
            </div>
            {(pendingTransfer || pendingPo) && (
              <div className="warehouse-popup-session">
                <div className="warehouse-session-lines">
                  {session.lines.map((line) => (
                    <div key={line.id} className="warehouse-session-line">
                      <span>{line.sku}</span>
                      <span>× {line.qty}</span>
                      {pendingPo && line.poLineId && (
                        <label className="warehouse-damage-field">
                          {requiredLocalized(l10n, 'warehouse-receive-damaged')}:
                          <input
                            type="number"
                            min={0}
                            max={line.qty}
                            value={line.damagedQty}
                            aria-label={`Damaged ${line.sku}`}
                            onChange={(e) => session.setDamagedQty(line.id, parseInt(e.target.value, 10) || 0)}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {pendingTransfer && (
                  <Button variant="primary" onClick={completeReceive}>
                    {requiredLocalized(l10n, 'warehouse-session-complete-receive')}
                  </Button>
                )}
                {pendingPo && (
                  <Button variant="primary" onClick={completeReceivePo}>
                    {requiredLocalized(l10n, 'warehouse-session-complete-receive')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Send popup (F2) ── */}
      {sendPopupOpen && (
        <div className="warehouse-popup">
          <div className="warehouse-popup-head">
            <h2>{requiredLocalized(l10n, 'warehouse-popup-send-title')}</h2>
            <button type="button" className="warehouse-popup-close" onClick={() => setSendPopupOpen(false)}>
              {requiredLocalized(l10n, 'warehouse-popup-close')}
            </button>
          </div>
          <div className="warehouse-popup-body">
            <Button variant="secondary" onClick={() => setDestinationOpen(true)}>
              {requiredLocalized(l10n, 'warehouse-send-destination')}
            </Button>
            <div className="warehouse-session-lines">
              {session.lines.map((line) => (
                <div key={line.id} className="warehouse-session-line">
                  <span>{line.sku}</span>
                  <span>× {line.qty}</span>
                </div>
              ))}
            </div>
            <Button variant="primary" onClick={completeSend} disabled={!session.fullyPicked}>
              {requiredLocalized(l10n, 'warehouse-session-complete-send')}
            </Button>
          </div>
        </div>
      )}

      {/* ── Transfer picker dialog ── */}
      {transferListOpen && (
        <ConfirmDialog
          open
          title={requiredLocalized(l10n, 'warehouse-receive-source-transfer')}
          message={
            inTransitFailed ? (
              <p role="alert">{requiredLocalized(l10n, 'warehouse-receive-load-failed')}</p>
            ) : inTransit.length === 0 ? (
              <p>{requiredLocalized(l10n, 'warehouse-receive-no-transfers')}</p>
            ) : (
              <ul className="warehouse-transfer-list">
                {inTransit.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="warehouse-transfer-item" onClick={() => pickTransfer(t)}>
                      {t.number} · {t.lines.length} lines
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
          confirmLabel={requiredLocalized(l10n, 'warehouse-popup-close')}
          cancelLabel={requiredLocalized(l10n, 'warehouse-adjust-cancel')}
          onConfirm={() => setTransferListOpen(false)}
          onCancel={() => setTransferListOpen(false)}
        />
      )}

      {/* ── PO picker dialog (Phase 2) ── */}
      {poListOpen && (
        <ConfirmDialog
          open
          title={requiredLocalized(l10n, 'warehouse-receive-source-po')}
          message={
            poListFailed ? (
              <p role="alert">{requiredLocalized(l10n, 'warehouse-receive-load-failed')}</p>
            ) : poList.length === 0 ? (
              <p>{requiredLocalized(l10n, 'warehouse-receive-no-pos')}</p>
            ) : (
              <ul className="warehouse-transfer-list">
                {poList.map((po) => (
                  <li key={po.id}>
                    <button type="button" className="warehouse-transfer-item" onClick={() => pickPo(po)}>
                      {po.po_number} · {po.supplier_name ?? '—'} · {po.lines.length} lines
                    </button>
                  </li>
                ))}
              </ul>
            )
          }
          confirmLabel={requiredLocalized(l10n, 'warehouse-popup-close')}
          cancelLabel={requiredLocalized(l10n, 'warehouse-adjust-cancel')}
          onConfirm={() => setPoListOpen(false)}
          onCancel={() => setPoListOpen(false)}
        />
      )}

      {/* ── Destination dialog ── */}
      {destinationOpen && (
        <ConfirmDialog
          open
          title={requiredLocalized(l10n, 'warehouse-send-destination')}
          message={<p>{requiredLocalized(l10n, 'warehouse-send-destination-aria')} — Phase 1 shell</p>}
          confirmLabel={requiredLocalized(l10n, 'warehouse-popup-close')}
          cancelLabel={requiredLocalized(l10n, 'warehouse-adjust-cancel')}
          onConfirm={() => setDestinationOpen(false)}
          onCancel={() => setDestinationOpen(false)}
        />
      )}
    </div>
  );
}