import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { useAdminGate } from '@/contexts/SubscriptionContext';
import { requiredLocalized } from '@/frontend/shared';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { Localized, useLocalization } from '@fluent/react';
import { buildCustomReport, type CustomReportRequest, type CustomReportResponse } from '@/api/reports';
import { getPrimaryLocationScoped } from '@/api/locations';
import { isoDaysAgo, isoToday } from '@/features/analytics/analytics-data';
import { buildCsv, downloadCsv } from './csv';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import './CustomReportScreen.css';

/** Dataset definitions with human-readable column labels. Matches backend `get_dataset_def()`. */
const DATASETS = {
  sales: {
    label: 'Sales History',
    columns: { id: 'Sale ID', total_minor: 'Total', created_at: 'Created', status: 'Status', customer_id: 'Customer' },
    hasDateFilter: true,
  },
  inventory: {
    label: 'Current Inventory',
    columns: { sku: 'SKU', name: 'Name', price_minor: 'Price', category_id: 'Category', barcode: 'Barcode', product_type: 'Type' },
    hasDateFilter: false,
  },
  customers: {
    label: 'Customers',
    columns: { id: 'Customer ID', name: 'Name', email: 'Email', phone: 'Phone', loyalty_points: 'Loyalty Points', total_spent_minor: 'Total Spent', created_at: 'Created' },
    hasDateFilter: true,
  },
  staff: {
    label: 'Staff',
    columns: { id: 'User ID', username: 'Username', display_name: 'Display Name', is_active: 'Active', created_at: 'Created' },
    hasDateFilter: false,
  },
  tax_rates: {
    label: 'Tax Rates',
    columns: { id: 'Rate ID', name: 'Name', rate_bps: 'Rate (bps)', is_default: 'Default', created_at: 'Created' },
    hasDateFilter: false,
  },
  shifts: {
    label: 'Shifts',
    columns: { id: 'Shift ID', user_id: 'User ID', opened_at: 'Opened', closed_at: 'Closed', status: 'Status', total_sales_minor: 'Total Sales', opening_balance_minor: 'Opening Balance', closing_balance_minor: 'Closing Balance' },
    hasDateFilter: true,
  },
};

// today()/monthAgo() replaced by isoToday()/isoDaysAgo() from
// features/analytics/analytics-data (R36-06): the old pair anchored the default
// window to UTC, which is host-independent but blind to the store's zone.

/** A column entry with selection state and display label. */
interface ColumnItem {
  key: string;
  label: string;
  selected: boolean;
}

/** Custom report builder — dataset picker, drag-and-drop column selector, preview table, CSV export. */
type DatasetKey = keyof typeof DATASETS;

/** §B administrative gate — Reports lock while the subscription is not `active`. */
export default function CustomReportScreen() {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return <CustomReportScreenContent />;
}

function CustomReportScreenContent() {
  const { l10n } = useLocalization();
  // R36-07: read the token through the useWorkspace() hook rather than the
// raw context object. The global test harness mocks the hook, not the
// context, so the direct form silently yielded an empty token and skipped
// every token-gated effect. AppProviders wraps the routed tree in the
// provider, so the hook's throw-outside-provider path is unreachable here.
const { sessionToken: rawToken } = useWorkspace();
  const sessionToken = rawToken || '';
  const [dataset, setDataset] = useState<DatasetKey>('sales');
  // REP-03/R36-06: anchor the default window to the PRIMARY STORE's calendar
  // day; FALLBACK_STORE_TZ (UTC) until the profile loads or if the fetch fails.
  const [storeTz, setStoreTz] = useState<string | null>(null);
  const rangeTouched = useRef(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(isoToday());
  useEffect(() => {
    if (!sessionToken) return;
    let alive = true;
    getPrimaryLocationScoped(sessionToken)
      .then((p) => { if (alive) setStoreTz(p?.timezone ?? null); })
      .catch(() => { /* storeTz stays null -> the UTC fallback applies */ });
    return () => { alive = false; };
  }, [sessionToken]);
  useEffect(() => {
    if (!storeTz || rangeTouched.current) return;
    setStartDate(isoDaysAgo(30, storeTz));
    setEndDate(isoToday(storeTz));
  }, [storeTz]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CustomReportResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination state (REP-07)
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 1000; // Matches backend MAX_LIMIT

  // Drag state
  const dragItemRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const dsDef = DATASETS[dataset];

  // Build ordered column list — start with all columns selected in definition order
  const [columnOrder, setColumnOrder] = useState<string[]>(() => Object.keys(dsDef.columns));
  const [selectedCols, setSelectedCols] = useState<Set<string>>(() => new Set(Object.keys(dsDef.columns)));

  // Reset when dataset changes
  const changeDataset = useCallback((newDs: DatasetKey) => {
    setDataset(newDs);
    setResult(null);
    const cols = Object.keys(DATASETS[newDs].columns);
    setColumnOrder(cols);
    setSelectedCols(new Set(cols));
    setSearchTerm('');
  }, []);

  /** Build the ordered column items respecting selected state and current order. */
  const columnItems = useMemo((): ColumnItem[] => {
    // Start with all keys from the definition, in the user's chosen order
    const allKeys = new Set(Object.keys(dsDef.columns));
    const ordered: ColumnItem[] = [];

    // Add keys from current order that exist in this dataset
    for (const key of columnOrder) {
      if (allKeys.has(key)) {
        ordered.push({ key, label: dsDef.columns[key as keyof typeof dsDef.columns] ?? key, selected: selectedCols.has(key) });
        allKeys.delete(key);
      }
    }
    // Add any remaining keys not yet in the order (shouldn't happen normally)
    for (const key of allKeys) {
      ordered.push({ key, label: dsDef.columns[key as keyof typeof dsDef.columns] ?? key, selected: selectedCols.has(key) });
    }

    return ordered;
  }, [dsDef, columnOrder, selectedCols]);

  /** Filter column items by search term. */
  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return columnItems;
    const lower = searchTerm.toLowerCase();
    return columnItems.filter(
      (item) => item.key.toLowerCase().includes(lower) || item.label.toLowerCase().includes(lower),
    );
  }, [columnItems, searchTerm]);

  const toggleCol = useCallback((key: string) => {
    setSelectedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectedCount = useMemo(() => selectedCols.size, [selectedCols]);

  // Drag-over visual feedback state
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // ── Drag-and-drop handlers ──

  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverRef.current = index;
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(() => {
    setDragOverIndex(null);
    const fromIdx = dragItemRef.current;
    const toIdx = dragOverRef.current;
    if (fromIdx === null || toIdx === null || fromIdx === toIdx) {
      dragItemRef.current = null;
      dragOverRef.current = null;
      return;
    }

    setColumnOrder((prev) => {
      const next = [...prev];
      const moved = next.splice(fromIdx, 1)[0];
      if (moved) next.splice(toIdx, 0, moved);
      return next;
    });
    dragItemRef.current = null;
    dragOverRef.current = null;
  }, []);

  const handleDragEnd = useCallback(() => {
    dragItemRef.current = null;
    dragOverRef.current = null;
    setDragOverIndex(null);
  }, []);

  const runReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build columns array in drag-order, only including selected ones
      const orderedSelected = columnOrder.filter((c) => selectedCols.has(c));
      const req: CustomReportRequest = {
        dataset,
        columns: orderedSelected,
        start_date: dsDef.hasDateFilter ? startDate : null,
        end_date: dsDef.hasDateFilter ? endDate : null,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      const resp = await buildCustomReport(req, sessionToken);
      setResult(resp);
    } catch (e: unknown) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [dataset, columnOrder, selectedCols, startDate, endDate, dsDef, sessionToken, page]);

  const exportCsv = useCallback(() => {
    if (!result || result.rows.length === 0) return;
    const csv = buildCsv(result.columns, result.rows);
    downloadCsv(csv, `custom-report-${dataset}-${startDate}-${endDate}.csv`);
  }, [result, dataset, startDate, endDate]);

  const hasResults = result && result.rows.length > 0;
  const hasEmptyResults = result && result.rows.length === 0;

  return (
    <div className="custom-report" role="region" aria-label={requiredLocalized(l10n, 'custom-report-region-aria')}>
      <div className="custom-report-header">
        <Localized id="custom-report-title">
          <h1 className="custom-report-title">Custom Report</h1>
        </Localized>
      </div>

      <Card shadow="sm" className="custom-report-config-card">
        <div className="custom-report-controls">
          <div className="custom-report-field">
            <label htmlFor="cr-dataset" className="custom-report-label">
              <Localized id="custom-report-dataset">Dataset</Localized>
            </label>
            <select
              id="cr-dataset"
              value={dataset}
              onChange={(e) => { changeDataset(e.target.value as DatasetKey); }}
              className="custom-report-select"
              aria-label={requiredLocalized(l10n, 'custom-report-dataset-aria')}
            >
              {Object.entries(DATASETS).map(([key, def]) => (
                <option key={key} value={key}>{def.label}</option>
              ))}
            </select>
          </div>

          {dsDef.hasDateFilter && (
            <>
              <div className="custom-report-field">
                <label htmlFor="cr-start" className="custom-report-label">
                  <Localized id="custom-report-start">Start</Localized>
                </label>
                <input id="cr-start" type="date" value={startDate} onChange={(e) => { rangeTouched.current = true; setStartDate(e.target.value); }} className="custom-report-input" aria-label={requiredLocalized(l10n, 'custom-report-start-aria')} />
              </div>
              <div className="custom-report-field">
                <label htmlFor="cr-end" className="custom-report-label">
                  <Localized id="custom-report-end">End</Localized>
                </label>
                <input id="cr-end" type="date" value={endDate} onChange={(e) => { rangeTouched.current = true; setEndDate(e.target.value); }} className="custom-report-input" aria-label={requiredLocalized(l10n, 'custom-report-end-aria')} />
              </div>
            </>
          )}
        </div>

        <div className="custom-report-columns-section">
          <div className="custom-report-columns-header">
            <div className="custom-report-columns-title-row">
              <Localized id="custom-report-columns">
                <span className="custom-report-label">Columns</span>
              </Localized>
              <span className="custom-report-columns-count" aria-live="polite">
                {requiredLocalized(l10n, 'custom-report-columns-selected', { selected: String(selectedCount), total: String(filteredItems.length) })}
              </span>
            </div>
            <div className="custom-report-columns-search">
              <input
                type="search"
                className="custom-report-search-input"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
                placeholder={requiredLocalized(l10n, 'custom-report-search-placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label={requiredLocalized(l10n, 'custom-report-search-aria')}
              />
              {searchTerm && (
                <button
                  className="custom-report-search-clear"
                  onClick={() => setSearchTerm('')}
                  aria-label={requiredLocalized(l10n, 'custom-report-search-clear-aria')}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="custom-report-columns-list" role="listbox" aria-label={requiredLocalized(l10n, 'custom-report-columns-aria')} aria-multiselectable="true">
            {filteredItems.map((item, index) => (
              <div
                key={item.key}
                className={`custom-report-col-item ${item.selected ? 'custom-report-col-item--selected' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                role="option"
                tabIndex={0}
                aria-selected={item.selected}
              >
                <span className="custom-report-col-drag-handle" aria-hidden="true">
                  ⠿
                </span>
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => toggleCol(item.key)}
                  aria-label={item.label}
                  className="custom-report-col-checkbox-input"
                />
                <span className="custom-report-col-label">{item.label}</span>
                <span className="custom-report-col-key">{item.key}</span>
              </div>
            ))}
            {filteredItems.length === 0 && (
              <p className="custom-report-col-no-results">
                <Localized id="custom-report-no-columns-match">No columns match your search</Localized>
              </p>
            )}
          </div>
        </div>

        <div className="custom-report-actions">
          <Button onClick={runReport} disabled={loading || selectedCount === 0} aria-label={requiredLocalized(l10n, 'custom-report-run-aria')}>
            {loading ? (
              <Localized id="shared-loading">Loading…</Localized>
            ) : (
              <Localized id="custom-report-run">Run Report</Localized>
            )}
          </Button>
        </div>
      </Card>

      {error && <p className="custom-report-error"><Localized id="error-occurred"><span>An error occurred</span></Localized>: {error}</p>}

      {hasEmptyResults && (
        <p className="custom-report-no-data">
          <Localized id="no-results"><span>No results found</span></Localized>
        </p>
      )}

      {hasResults && (
        <Card shadow="sm" className="custom-report-result-card">
          <div className="custom-report-result-header">
            <Localized id="custom-report-results">
              <h2 className="custom-report-section-title">Results</h2>
            </Localized>
            <Button variant="secondary" onClick={exportCsv} aria-label={requiredLocalized(l10n, 'custom-report-export-aria')}>
              <Localized id="custom-report-export-csv">Export CSV</Localized>
            </Button>
          </div>
          {result?.truncated && (
            <p className="custom-report-truncated" role="status" aria-live="polite">
              {l10n.getString('custom-report-truncated', { limit: String(PAGE_SIZE) })}
            </p>
          )}
          <div className="custom-report-table-wrap">
            <table className="custom-report-table">
              <thead>
                <tr>
                  {result?.columns.map((col) => (
                    <th key={col}>{dsDef.columns[col as keyof typeof dsDef.columns] ?? col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{result?.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
</tbody>
            </table>
          </div>
          {result?.truncated && (
            <div className="custom-report-pagination" role="navigation" aria-label={requiredLocalized(l10n, 'custom-report-pagination-aria')}>
              <Button
                variant="ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                aria-label={requiredLocalized(l10n, 'custom-report-prev-page-aria')}
              >
                <Localized id="custom-report-prev-page">Previous</Localized>
              </Button>
              <span className="custom-report-page-info" aria-live="polite">
                {l10n.getString('custom-report-page-of', { page: String(page) })}
              </span>
              <Button
                variant="ghost"
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || !result?.truncated}
                aria-label={requiredLocalized(l10n, 'custom-report-next-page-aria')}
              >
                <Localized id="custom-report-next-page">Next</Localized>
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
