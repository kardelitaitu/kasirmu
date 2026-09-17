import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Localized, useLocalization } from '@fluent/react';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import {
  getStockCount,
  getCountLines,
  addCountLine,
  updateCountLine,
  removeCountLine,
  completeStockCount,
  updateStockCountStatus,
  type StockCountDto,
  type StockCountLineDto,
} from '@/api/inventoryCounts';
import { type ProductDto, listProductsScoped } from '@/api/products';
import { l10nErrorMessage } from '@/utils/app-error';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import './StockCountDetail.css';
// The sc-badge family this screen paints at :243 lives in its own sheet, not in the
// list screen's -- import it here so the styling no longer depends on the flow's static import.
import './StockCountBadge.css';

interface Props {
  countId: string;
  onBack: () => void;
}

/** Stock count detail view — display and manage individual count lines with product search and quantity entry. */
export default function StockCountDetail({ countId, onBack }: Props) {
  const [count, setCount] = useState<StockCountDto | null>(null);
  const [lines, setLines] = useState<StockCountLineDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Product search
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [expectedQty, setExpectedQty] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { l10n } = useLocalization();
  const l10nRef = useRef(l10n);
  l10nRef.current = l10n;
  // Date formatting follows the active Fluent locale.
  const numLocale = [...l10n.bundles][0]?.locales[0] ?? 'en-US';
  const { addToast } = useToast();
  const { sessionToken: rawSessionToken } = useWorkspace();
  const sessionToken = rawSessionToken ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!sessionToken) throw new Error('session unavailable');
      const c = await getStockCount(sessionToken, countId);
      setCount(c);
      if (c) {
        setLines(await getCountLines(sessionToken, countId));
      }
    } catch (err) {
      const message = l10nErrorMessage(err, l10nRef.current, 'sc-error-load');
      setError(message);
      addToast({ message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [countId, addToast, sessionToken]);

  useEffect(() => {
    load();
    if (sessionToken) {
      listProductsScoped(sessionToken).then(setProducts).catch(() => {
        addToast({ message: requiredLocalized(l10nRef.current, 'sc-error-products'), type: 'error' });
      });
    }
  }, [load, sessionToken, addToast]);

  const isEditable = count?.status === 'draft' || count?.status === 'in_progress';

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? '').includes(q),
    );
  }, [products, searchQuery]);

  const handleAddLine = useCallback(async () => {
    if (!selectedSku || !expectedQty) return;
    const expectedNum = Number(expectedQty);
    if (!Number.isInteger(expectedNum) || expectedNum < 0) {
      setError(l10nRef.current.getString('sc-error-qty-integer'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!sessionToken) throw new Error('session unavailable');
      await addCountLine(sessionToken, {
        countId,
        sku: selectedSku,
        productName: selectedName,
        expectedQty: Number(expectedQty),
      });
      setSelectedSku('');
      setSelectedName('');
      setExpectedQty('');
      setSearchQuery('');
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'sc-error-add-line'));
    } finally {
      setSaving(false);
    }
  }, [countId, selectedSku, selectedName, expectedQty, load, sessionToken]);

  const handleRecordCount = useCallback(async (lineId: string, countedQty: number) => {
    try {
      if (!sessionToken) throw new Error('session unavailable');
      await updateCountLine(sessionToken, { lineId, countedQty, notes: '' });
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'sc-error-update-line'));
    }
  }, [load, sessionToken]);

  const handleRemoveLine = useCallback(async (lineId: string) => {
    try {
      if (!sessionToken) throw new Error('session unavailable');
      await removeCountLine(sessionToken, { lineId });
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'sc-error-remove-line'));
    }
  }, [load, sessionToken]);

  const handleStartCounting = useCallback(async () => {
    try {
      if (!sessionToken) throw new Error('session unavailable');
      await updateStockCountStatus(sessionToken, countId, 'in_progress');
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'sc-error-start-count'));
    }
  }, [countId, load, sessionToken]);

  const handleComplete = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (!sessionToken) throw new Error('session unavailable');
      const adjustments = await completeStockCount(sessionToken, { countId });
      setSuccessMsg(
        l10nRef.current.getString('sc-complete-success', { count: adjustments.length }),
      );
      await load();
    } catch (err) {
      setError(l10nErrorMessage(err, l10nRef.current, 'sc-error-complete'));
    } finally {
      setSaving(false);
    }
  }, [countId, load, sessionToken]);

  const totalExpected = lines.reduce((s, l) => s + l.expected_qty, 0);
  const totalCounted = lines.reduce((s, l) => s + (l.counted_qty ?? 0), 0);
  const totalDiff = lines.reduce((s, l) => s + l.difference, 0);

  if (loading) {
    return (
      <div className="sc-detail-screen" aria-hidden="true">
        <div className="sc-detail-header">
          <Skeleton variant="text" width="4rem" height="1.125rem" />
          <Skeleton variant="block" width="8rem" height="1.5rem" />
        </div>
        <div className="sc-detail-meta">
          <Skeleton variant="block" width="4rem" height="1.125rem" style={{ borderRadius: 'var(--radius-sm)' }} />
          <Skeleton variant="text" width="3rem" height="0.875rem" />
          <Skeleton variant="text" width="6rem" height="0.875rem" />
        </div>
        <div className="sc-detail-actions" style={{ marginBottom: 'var(--space-4)' }}>
          <Skeleton variant="block" width="10rem" height="2.25rem" />
        </div>
        {/* Lines table skeleton */}
        <div className="sc-detail-lines">
          <div className="sc-lines-header">
            {['SKU', 'Product', 'Expected', 'Counted', 'Diff', ''].map((_, i) => (
              <span key={i} className={i < 5 ? 'sc-lines-col-' + ['sku','name','expected','counted','diff'][i] : 'sc-lines-col-actions'}>
                <Skeleton variant="text" width="3rem" height="0.75rem" />
              </span>
            ))}
          </div>
          {[0, 1, 2, 3].map((r) => (
            <div key={r} className="sc-lines-row">
              <span className="sc-lines-col-sku"><Skeleton variant="text" width="4rem" height="0.75rem" /></span>
              <span className="sc-lines-col-name"><Skeleton variant="text" width="7rem" height="0.875rem" /></span>
              <span className="sc-lines-col-expected"><Skeleton variant="text" width="2rem" height="0.875rem" /></span>
              <span className="sc-lines-col-counted"><Skeleton variant="block" width="3rem" height="1.375rem" /></span>
              <span className="sc-lines-col-diff"><Skeleton variant="text" width="2rem" height="0.875rem" /></span>
              <span className="sc-lines-col-actions"><Skeleton variant="block" width="1.25rem" height="1.25rem" /></span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!count) {
    return (
      <div className="sc-detail-screen">
        {error ? (
          <div className="sc-load-error" role="alert">
            <p>{error}</p>
            <Button variant="secondary" onClick={load}>
              <Localized id="retry"><span>Retry</span></Localized>
            </Button>
          </div>
        ) : (
          <p className="sc-detail-error">
            <Localized id="sc-not-found"><span>Count not found.</span></Localized>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="sc-detail-screen">
      <div className="sc-detail-header">
        <button type="button" className="sc-detail-back" onClick={onBack}>
          &larr; <Localized id="sc-back"><span>Back</span></Localized>
        </button>
        <h1 className="sc-title">{count.count_number}</h1>
      </div>

      <div className="sc-detail-meta">
        <span className={`sc-badge sc-badge--${count.status}`}>
          <Localized id={`sc-status-${count.status}`}>{count.status}</Localized>
        </span>
        <span><Localized id={`sc-type-${count.count_type}`}>{count.count_type}</Localized></span>
        <span>{new Date(count.created_at).toLocaleDateString(numLocale)}</span>
      </div>

      {count.notes && <p className="sc-detail-notes">{count.notes}</p>}

      {error && <div className="sc-detail-err" role="alert">{error}</div>}
      {successMsg && <div className="sc-detail-success" role="status">{successMsg}</div>}

      {/* Actions */}
      <div className="sc-detail-actions">
        {count.status === 'draft' && (
          <Button variant="primary" onClick={handleStartCounting}>
            <Localized id="sc-start-counting"><span>Start Counting</span></Localized>
          </Button>
        )}
        {isEditable && lines.length > 0 && (
          <Button variant="primary" onClick={handleComplete} loading={saving}>
            <Localized id="sc-complete-count"><span>Complete Count</span></Localized>
          </Button>
        )}
      </div>

      {/* Add line */}
      {isEditable && (
        <Card shadow="sm" className="sc-detail-add-line">
          <h3><Localized id="sc-add-line"><span>Add Product to Count</span></Localized></h3>
          <div className="sc-add-line-search">
            <input
              type="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              placeholder={l10n.getString('sc-search-placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={l10n.getString('sc-search-aria')}
            />
          </div>
          {searchQuery && filteredProducts.length > 0 && (
            <div className="sc-add-line-results">
              {filteredProducts.slice(0, 8).map((p) => (
                <button
                  key={p.sku}
                  type="button"
                  className={`sc-add-line-item ${selectedSku === p.sku ? 'sc-add-line-item--sel' : ''}`}
                  onClick={() => {
                    setSelectedSku(p.sku);
                    setSelectedName(p.name);
                    setExpectedQty(String(p.stock_qty ?? 0));
                    setSearchQuery('');
                  }}
                >
                  <span className="sc-add-line-name">{p.name}</span>
                  <span className="sc-add-line-sku">{p.sku}</span>
                  <span className="sc-add-line-stock">{p.stock_qty ?? '—'}</span>
                </button>
              ))}
            </div>
          )}
          {selectedSku && (
            <div className="sc-add-line-form">
              <span className="sc-add-line-selected">{selectedName} ({selectedSku})</span>
              <div>
                <Localized id="sc-expected-qty"><span>Expected Qty</span></Localized>
                <input
                  type="number"
                  value={expectedQty}
                  onChange={(e) => setExpectedQty(e.target.value)}
                  min="0"
                  aria-label={l10n.getString('sc-expected-qty')}
                />
              </div>
              <Button variant="primary" onClick={handleAddLine} loading={saving} disabled={!expectedQty}>
                <Localized id="sc-add"><span>Add</span></Localized>
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Lines table */}
      {lines.length > 0 ? (
        <div className="sc-detail-lines">
          <div className="sc-lines-header">
            <span className="sc-lines-col-sku"><Localized id="sc-col-sku"><span>SKU</span></Localized></span>
            <span className="sc-lines-col-name"><Localized id="sc-col-name"><span>Product</span></Localized></span>
            <span className="sc-lines-col-expected"><Localized id="sc-col-expected"><span>Expected</span></Localized></span>
            <span className="sc-lines-col-counted"><Localized id="sc-col-counted"><span>Counted</span></Localized></span>
            <span className="sc-lines-col-diff"><Localized id="sc-col-diff"><span>Diff</span></Localized></span>
            {isEditable && <span className="sc-lines-col-actions"></span>}
          </div>
          {lines.map((line) => (
            <div key={line.id} className="sc-lines-row">
              <span className="sc-lines-col-sku">{line.sku}</span>
              <span className="sc-lines-col-name">{line.product_name}</span>
              <span className="sc-lines-col-expected">{line.expected_qty}</span>
              <span className="sc-lines-col-counted">
                {isEditable ? (
                  <input
                    type="number"
                    className="sc-counted-input"
                    value={line.counted_qty ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      // Counted quantities are whole units; ignore fractional
                      // in-progress input instead of silently truncating it.
                      if (Number.isInteger(v) && v >= 0) handleRecordCount(line.id, v);
                    }}
                    min="0"
                    aria-label={l10n.getString('sc-counted-aria', { sku: line.sku })}
                  />
                ) : (
                  line.counted_qty ?? '—'
                )}
              </span>
              <span className={`sc-lines-col-diff ${line.difference < 0 ? 'sc-diff-neg' : line.difference > 0 ? 'sc-diff-pos' : ''}`}>
                {line.counted_qty != null ? (line.difference > 0 ? '+' : '') + line.difference : '—'}
              </span>
              {isEditable && (
                <span className="sc-lines-col-actions">
                  <button
                    type="button"
                    className="sc-remove-btn"
                    onClick={() => handleRemoveLine(line.id)}
                    aria-label={l10n.getString('sc-remove-aria', { sku: line.sku })}
                  >
                    &times;
                  </button>
                </span>
              )}
            </div>
          ))}
          <div className="sc-lines-total">
            <span className="sc-lines-col-sku"></span>
            <span className="sc-lines-col-name"><strong><Localized id="sc-total"><span>Total</span></Localized></strong></span>
            <span className="sc-lines-col-expected"><strong>{totalExpected}</strong></span>
            <span className="sc-lines-col-counted"><strong>{totalCounted}</strong></span>
            <span className={`sc-lines-col-diff ${totalDiff < 0 ? 'sc-diff-neg' : totalDiff > 0 ? 'sc-diff-pos' : ''}`}>
              <strong>{totalDiff > 0 ? '+' : ''}{totalDiff}</strong>
            </span>
          </div>
        </div>
      ) : (
        <p className="sc-detail-empty">
          <Localized id="sc-no-lines">
            <span>No products added yet. Search and add products above.</span>
          </Localized>
        </p>
      )}
    </div>
  );
}
