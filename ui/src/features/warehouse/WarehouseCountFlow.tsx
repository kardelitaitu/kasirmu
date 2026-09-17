// ── ui/src/features/warehouse/WarehouseCountFlow.tsx ─────────────────────
// Barcode-first cycle counting for the warehouse console (Phase 3).
// Self-contained wrapper over the stock_counts commands — no imports from
// features/inventory. Flow:
//   1. Create a count (full/cyclic/spot) or resume a draft/in_progress one
//   2. Scan barcode (or pick from grid) → line added with expected qty
//   3. Record counted qty per line
//   4. Complete the count → adjustments posted by the backend

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import { requiredLocalized } from '@/components';
import { useToast } from '@/components/Toast';
import { l10nErrorMessage } from '@/utils/app-error';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  createStockCount,
  listStockCounts,
  getCountLines,
  addCountLine,
  updateCountLine,
  removeCountLine,
  updateStockCountStatus,
  completeStockCount,
  type StockCountDto,
  type StockCountLineDto,
} from '@/api/inventoryCounts';
import { listWarehouseProductsAtLocation, type ProductDto } from '@/api/products';

/**
 * One settled read. `ok: false` means the call NEVER ANSWERED — a different
 * fact from "answered, and the answer was an empty list". The shape is the
 * sanctioned boot idiom (frontend/shell/AppShell.tsx:87-94); the load-bearing
 * half is that the caller writes nothing on `ok: false`, so the state keeps
 * its UNKNOWN value instead of being overwritten with a plausible empty one.
 */
type Read<T> = { ok: true; value: T } | { ok: false };

async function settle<T>(label: string, read: Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read };
  } catch (err) {
    console.error(`[warehouse-count] ${label} read failed — recording unknown:`, err);
    return { ok: false };
  }
}

interface Props {
  sessionToken: string;
  locationId: string;
  onCompleted: () => void;
}

type CountType = 'full' | 'cyclic' | 'spot';

export default function WarehouseCountFlow({ sessionToken, locationId, onCompleted }: Props) {
  const { l10n } = useLocalization();
  const { addToast } = useToast();

  const [counts, setCounts] = useState<StockCountDto[]>([]);
  const [activeCount, setActiveCount] = useState<StockCountDto | null>(null);
  const [lines, setLines] = useState<StockCountLineDto[]>([]);
  // null = UNKNOWN (the catalogue read never answered); [] = the ANSWER that
  // this location has no products. They render the same empty picker and the
  // same failed scan, which is the whole bug this file had: only one of them
  // is a fact about the store, so a cashier was told "no product matches that
  // barcode" about a catalogue nobody had been able to read.
  const [products, setProducts] = useState<ProductDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-count modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [countType, setCountType] = useState<CountType>('cyclic');
  const [notes, setNotes] = useState('');

  // Scan input
  const [scanInput, setScanInput] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const loadCounts = useCallback(async () => {
    if (!sessionToken) return;
    try {
      setCounts(await listStockCounts(sessionToken));
    } catch {
      // Non-critical
    }
  }, [sessionToken]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (!sessionToken || !locationId) {
      // Nothing was asked, so nothing is known — NOT "there are none".
      setProducts(null);
      return;
    }
    let cancelled = false;
    void settle('product catalogue', listWarehouseProductsAtLocation(sessionToken, locationId)).then(
      (read) => {
        // A throw writes nothing, so the catalogue stays UNKNOWN.
        if (!cancelled && read.ok) setProducts(read.value);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionToken, locationId]);

  const loadLines = useCallback(async () => {
    if (!sessionToken || !activeCount) return;
    setLoading(true);
    try {
      setLines(await getCountLines(sessionToken, activeCount.id));
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'warehouse-count-error'));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, activeCount, l10n]);

  useEffect(() => {
    void loadLines();
  }, [loadLines, activeCount?.id]);

  // ── Create count ────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    if (!sessionToken) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createStockCount(sessionToken, { countType, notes });
      await updateStockCountStatus(sessionToken, created.id, 'in_progress');
      setActiveCount(created);
      setCreateOpen(false);
      setCountType('cyclic');
      setNotes('');
      await loadCounts();
      scanRef.current?.focus();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'warehouse-count-error'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, countType, notes, loadCounts, l10n]);

  const openCount = useCallback((count: StockCountDto) => {
    setActiveCount(count);
    if (count.status === 'draft') {
      void updateStockCountStatus(sessionToken, count.id, 'in_progress').catch(() => {});
    }
    scanRef.current?.focus();
  }, [sessionToken]);

  // ── Scan → add/record line ──────────────────────────────────────
  const resolveScan = useCallback(
    async (code: string) => {
      if (!sessionToken || !activeCount) return;
      const q = code.trim();
      if (!q) return;
      if (products === null) {
        // The catalogue never answered. Reporting that as a non-matching scan
        // would be a false lockout — the product may exist perfectly well.
        addToast({
          type: 'error',
          message: requiredLocalized(l10n, 'retail-load-error-unavailable'),
        });
        return;
      }
      const product =
        products.find((p) => p.barcode === q) ?? products.find((p) => p.sku === q);
      if (!product) {
        addToast({ type: 'warning', message: requiredLocalized(l10n, 'warehouse-scan-no-match') });
        return;
      }
      const existing = lines.find((l) => l.sku === product.sku);
      try {
        if (existing) {
          // Scan again = +1 counted
          await updateCountLine(sessionToken, {
            lineId: existing.id,
            countedQty: (existing.counted_qty ?? 0) + 1,
            notes: '',
          });
        } else {
          await addCountLine(sessionToken, {
            countId: activeCount.id,
            sku: product.sku,
            productName: product.name,
            expectedQty: product.stock_qty ?? 0,
          });
        }
        await loadLines();
      } catch (err) {
        addToast({ type: 'error', message: l10nErrorMessage(err, l10n, 'warehouse-count-error') });
      }
    },
    [sessionToken, activeCount, products, lines, loadLines, l10n, addToast],
  );

  const handleScanSubmit = useCallback(() => {
    void resolveScan(scanInput);
    setScanInput('');
    scanRef.current?.focus();
  }, [resolveScan, scanInput]);

  // ── Record / remove / complete ──────────────────────────────────
  const handleRecord = useCallback(
    async (lineId: string, countedQty: number) => {
      if (!sessionToken) return;
      try {
        await updateCountLine(sessionToken, { lineId, countedQty, notes: '' });
        await loadLines();
      } catch (err) {
        setError(l10nErrorMessage(err, l10n, 'warehouse-count-error'));
      }
    },
    [sessionToken, loadLines, l10n],
  );

  const handleRemove = useCallback(
    async (lineId: string) => {
      if (!sessionToken) return;
      try {
        await removeCountLine(sessionToken, { lineId });
        await loadLines();
      } catch (err) {
        setError(l10nErrorMessage(err, l10n, 'warehouse-count-error'));
      }
    },
    [sessionToken, loadLines, l10n],
  );

  const handleComplete = useCallback(async () => {
    if (!sessionToken || !activeCount) return;
    setSaving(true);
    setError(null);
    try {
      const adjustments = await completeStockCount(sessionToken, { countId: activeCount.id });
      addToast({
        type: 'success',
        message: requiredLocalized(l10n, 'warehouse-count-complete-success', {
          count: String(adjustments.length),
        }),
      });
      setActiveCount(null);
      setLines([]);
      await loadCounts();
      onCompleted();
    } catch (err) {
      setError(l10nErrorMessage(err, l10n, 'warehouse-count-error'));
    } finally {
      setSaving(false);
    }
  }, [sessionToken, activeCount, loadCounts, onCompleted, l10n, addToast]);

  // ── Active count view ───────────────────────────────────────────
  if (activeCount) {
    return (
      <div className="warehouse-count">
        <div className="warehouse-count-head">
          <h3 className="warehouse-count-title">{activeCount.count_number}</h3>
          <Button variant="secondary" onClick={() => setActiveCount(null)}>
            {requiredLocalized(l10n, 'warehouse-count-back')}
          </Button>
        </div>

        <div className="warehouse-scan-row">
          <input
            ref={scanRef}
            className="warehouse-scan-input"
            placeholder={requiredLocalized(l10n, 'warehouse-scan-placeholder')}
            aria-label={requiredLocalized(l10n, 'warehouse-scan-aria')}
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleScanSubmit();
            }}
          />
          <Button variant="primary" onClick={handleScanSubmit}>
            {requiredLocalized(l10n, 'warehouse-scan-add')}
          </Button>
        </div>

        {error && <div className="warehouse-error" role="alert">{error}</div>}

        {products === null && (
          <div className="warehouse-error" role="alert">
            {requiredLocalized(l10n, 'retail-load-error-unavailable')}
          </div>
        )}

        {loading ? (
          <>
            <Skeleton variant="block" width="100%" height="2.5rem" />
            <Skeleton variant="block" width="100%" height="2.5rem" />
          </>
        ) : lines.length === 0 ? (
          <div className="warehouse-empty-panel">
            {requiredLocalized(l10n, 'warehouse-count-empty')}
          </div>
        ) : (
          <>
            <div className="warehouse-session-lines">
              {lines.map((line) => (
                <div key={line.id} className="warehouse-session-line">
                  <div className="warehouse-session-line-info">
                    <span className="warehouse-session-line-sku">{line.sku}</span>
                    <span className="warehouse-session-line-name">{line.product_name}</span>
                    <span className="warehouse-session-line-bin">
                      {requiredLocalized(l10n, 'warehouse-receive-expected')}: {line.expected_qty}
                    </span>
                  </div>
                  <div className="warehouse-session-line-actions">
                    <input
                      type="number"
                      min={0}
                      className="warehouse-count-input"
                      value={line.counted_qty ?? ''}
                      aria-label={`Counted ${line.sku}`}
                      onChange={(e) => {
                        void handleRecord(line.id, parseInt(e.target.value, 10) || 0);
                      }}
                    />
                    <button
                      type="button"
                      className="warehouse-session-remove"
                      aria-label={`Remove ${line.sku}`}
                      onClick={() => void handleRemove(line.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="warehouse-session-footer">
              <span className="warehouse-session-count">
                {lines.length} {requiredLocalized(l10n, 'warehouse-count-lines')}
              </span>
              <Button variant="primary" onClick={() => void handleComplete()} disabled={saving || lines.length === 0}>
                {requiredLocalized(l10n, 'warehouse-count-complete')}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Count picker / create ───────────────────────────────────────
  const open = counts.filter((c) => c.status === 'draft' || c.status === 'in_progress');
  const history = counts.filter((c) => c.status === 'completed' || c.status === 'cancelled');

  return (
    <div className="warehouse-count">
      <div className="warehouse-count-actions">
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          {requiredLocalized(l10n, 'warehouse-count-create')}
        </Button>
      </div>

      {error && <div className="warehouse-error" role="alert">{error}</div>}

      {open.length > 0 && (
        <div className="warehouse-count-group">
          <h4 className="warehouse-count-group-title">
            {requiredLocalized(l10n, 'warehouse-count-open')}
          </h4>
          {open.map((c) => (
            <button key={c.id} type="button" className="warehouse-transfer-item" onClick={() => openCount(c)}>
              {c.count_number} · {c.count_type}
            </button>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="warehouse-count-group">
          <h4 className="warehouse-count-group-title">
            {requiredLocalized(l10n, 'warehouse-count-history')}
          </h4>
          {history.slice(0, 10).map((c) => (
            <div key={c.id} className="warehouse-count-history-item">
              {c.count_number} · {c.count_type} · {c.status}
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <ConfirmDialog
          open
          title={requiredLocalized(l10n, 'warehouse-count-create')}
          message={
            <div className="warehouse-count-create-body">
              <label className="warehouse-count-type-label">
                {requiredLocalized(l10n, 'warehouse-count-type')}
                <select
                  className="warehouse-select"
                  value={countType}
                  onChange={(e) => setCountType(e.target.value as CountType)}
                >
                  <option value="full">{requiredLocalized(l10n, 'sc-type-full')}</option>
                  <option value="cyclic">{requiredLocalized(l10n, 'sc-type-cyclic')}</option>
                  <option value="spot">{requiredLocalized(l10n, 'sc-type-spot')}</option>
                </select>
              </label>
              <label className="warehouse-count-type-label">
                {requiredLocalized(l10n, 'warehouse-count-notes')}
                <input
                  type="text"
                  className="warehouse-adjust-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>
          }
          confirmLabel={requiredLocalized(l10n, 'warehouse-count-start')}
          cancelLabel={requiredLocalized(l10n, 'warehouse-adjust-cancel')}
          loading={saving}
          onConfirm={() => void handleCreate()}
          onCancel={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}